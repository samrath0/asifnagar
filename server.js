const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv')
const _ = require('lodash');
const session = require('express-session');
const passport = require('passport');
const user_collection = require("./models/userModel");
const society_collection = require("./models/societyModel");
const visit_collection = require("./models/visitModel");
const db = require(__dirname+'/config/db');
const date = require(__dirname+'/date/date');
const crypto = require('crypto');

// Access environment variables
dotenv.config();
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const app = express()
app.set('view engine','ejs');
app.use(express.static('public'));
// Middleware to handle HTTP post requests
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.json());
app.use(session({
	secret:"This is the secret key",
	resave:false,
	saveUninitialized:false
}));
app.use(passport.initialize());
app.use(passport.session());
db.connectDB()

app.get("/", async (req, res) => {
    try {
        let pageVisit = await visit_collection.Visit.findOne({});
        
        if (!pageVisit) {
            pageVisit = new visit_collection.Visit({ count: 0 });
        }
        
        pageVisit.count += 1;
        await pageVisit.save();

        const foundSociety = await society_collection.Society.find({});
        const societyCount = foundSociety.length;

        const cities = foundSociety.map(society => society.societyAddress.city.toLowerCase());
        const cityCount = [...new Set(cities)].length;

        const foundUser = await user_collection.User.find({});
        const userCount = foundUser.length;

        res.render("index", {
            city: cityCount,
            society: societyCount,
            user: userCount,
            visit: pageVisit.count
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred while fetching data.");
    }
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/signup", async (req, res) => {
    try {
        const foundSociety = await society_collection.Society.find();
        res.render("signup", { societies: foundSociety });
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/register", (req, res) => {
    res.render("register");
});

app.get("/home", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }

    const validationStatusMap = {
        'approved': "home",
        'applied': "homeStandby",
        'default': "homeStandby"
    };

    const renderDetails = {
        'applied': {
            icon: 'fa-user-clock',
            title: 'Account pending for approval',
            content: 'Your account will be active as soon as it is approved by your community. ' +
                     'It usually takes 1-2 days for approval. If it is taking longer to get approval, ' +
                     'contact your society admin.'
        },
        'default': {
            icon: 'fa-user-lock',
            title: 'Account approval declined',
            content: 'Your account registration has been declined. ' +
                     'Please contact the society administrator for more details. ' +
                     'You can edit the request and apply again.'
        }
    };

    const viewToRender = validationStatusMap[req.user.validation] || validationStatusMap['default'];
    const viewDetails = req.user.validation === 'applied' 
        ? renderDetails['applied'] 
        : renderDetails['default'];

    if (viewToRender === "homeStandby") {
        res.render(viewToRender, viewDetails);
    } else {
        res.render(viewToRender);
    }
});

app.get("/newRequest", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation !== 'approved') {
        try {
            const foundSociety = await society_collection.Society.find();
            res.render("signupEdit", { user: req.user, societies: foundSociety });
        } catch (err) {
            console.error(err);
            res.status(500).send("Internal Server Error");
        }
    } else {
        res.redirect("/home");
    }
});

app.get("/logout", (req, res) => {
    req.logout(function(err) {
        if (err) { 
            return next(err); 
        }
        res.redirect("/");
    });
});

app.get("/loginFailure", (req, res) => {
    res.render("failure", {
        message: "Sorry, entered password was incorrect. Please double-check.",
        href: "/login",
        messageSecondary: "Account not created?",
        hrefSecondary: "/signup",
        buttonSecondary: "Create Account"
    });
});

app.get("/residents", async (req, res) => {
    if (!req.isAuthenticated() || req.user.validation !== 'approved') {
        return res.redirect("/login");
    }

    try {
        const userSocietyName = req.user.societyName;
        const foundUsers = await user_collection.User.find({
            $and: [
                {"societyName": userSocietyName}, 
                {"validation": "approved"}
            ]
        });

        const foundAppliedUsers = await user_collection.User.find({
            $and: [
                {"societyName": userSocietyName}, 
                {"validation": "applied"}
            ]
        });

        res.render("residents", {
            societyResidents: foundUsers,
            appliedResidents: foundAppliedUsers,
            societyName: userSocietyName,
            isAdmin: req.user.isAdmin
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching residents");
    }
});

app.get("/noticeboard", async (req, res) => {
    if (!req.isAuthenticated() || req.user.validation !== 'approved') {
        return res.redirect("/login");
    }

    try {
        const foundSociety = await society_collection.Society.findOne({
            societyName: req.user.societyName
        });

        if (!foundSociety.noticeboard.length) {
            foundSociety.noticeboard = [{
                'subject': 'Access all important announcements, notices and circulars here.'
            }];
        }

        res.render("noticeboard", {
            notices: foundSociety.noticeboard, 
            isAdmin: req.user.isAdmin
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching noticeboard");
    }
});

app.get("/notice", (req, res) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        res.render("notice");
    } else {
        res.redirect("/login");
    }
});
function calculateMaintenanceBill(foundUser, foundSociety) {
    const dateToday = new Date();
    let totalMonth = 0;
    let dateFrom = foundUser.createdAt;
    
    if (foundUser.lastPayment && foundUser.lastPayment.date) {
        dateFrom = foundUser.lastPayment.date;
        totalMonth = date.monthDiff(dateFrom, dateToday);
    } else {
        totalMonth = date.monthDiff(dateFrom, dateToday) + 1;
    }
    
    const monthlyTotal = Object.values(foundSociety.maintenanceBill)
        .filter(ele => typeof(ele) === 'number')
        .reduce((sum, ele) => sum + ele, 0);
    
    let credit = 0;
    let due = 0;
    
    if (totalMonth === 0) {
        credit = monthlyTotal;
    } else if (totalMonth > 1) {
        due = (totalMonth - 1) * monthlyTotal;
    }
    
    const totalAmount = monthlyTotal + due - credit;

    return {
        totalMonth,
        monthlyTotal,
        credit,
        due,
        totalAmount
    };
}

// Bill Generation Route
app.get("/bill", async (req, res) => {
    try {
        // Authentication Checks
        if (!req.isAuthenticated()) {
            return res.redirect("/login");
        }

        // User Validation
        if (req.user.validation !== 'approved') {
            return res.status(403).send("Access denied");
        }

        // Validate user and society information
        if (!req.user.id || !req.user.societyName) {
            return res.status(400).send("Invalid user information");
        }

        // Fetch User and Society with Lean for Performance
        const foundUser = await user_collection.User.findById(req.user.id)
            .select('-password')
            .lean();

        if (!foundUser) {
            return res.status(404).send("User not found");
        }

        const foundSociety = await society_collection.Society.findOne({
            societyName: foundUser.societyName
        }).lean();
        console.log(foundSociety)

        if (!foundSociety) {
            return res.status(404).send("Society not found");
        }

        const foundUsers = await user_collection.User.find({
            $and: [
                {"societyName": req.user.societyName}, 
                {"validation": "approved"}
            ]
        });

        // Calculate Maintenance Bill
        const billCalculation = calculateMaintenanceBill(foundUser, foundSociety);

        // Generate a unique receipt number
        const receiptNumber = `RCPT-${foundUser._id.toString().slice(-6)}-${Date.now()}`;
        console.log({
            resident: {
                firstName: foundUser.firstName,
                lastName: foundUser.lastName,
                username: foundUser.username,
                phoneNumber: foundUser.phoneNumber
            },
            society: {
                societyName: foundSociety.societyName,
                address: foundSociety.societyAddress || 'Not Specified'
            },
            billDetails: {
                totalAmount: billCalculation.totalAmount,
                monthlyTotal: billCalculation.monthlyTotal,
                pendingDue: billCalculation.due,
                creditBalance: billCalculation.credit,
                totalMonths: billCalculation.totalMonth
            },
            receiptNumber: receiptNumber,
            receipt: foundUser.lastPayment || {},
            monthName: date.month,
            date: date.today,
            year: date.year,
            societyResidents: foundUsers,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID // Public key for frontend
        })
        // Render Bill Page
        res.render("bill", {
            resident: {
                firstName: foundUser.firstName,
                lastName: foundUser.lastName,
                username: foundUser.username,
                phoneNumber: foundUser.phoneNumber,
                flatNumber: foundUser.flatNumber,
                isAdmin: foundUser.isAdmin
            },
            society: {
                societyName: foundSociety.societyName,
                societyAddress: foundSociety.societyAddress || {
                    address: 'Not Specified',
                    city: 'Not Specified',
                    district: 'Not Specified',
                    postalCode: 'Not Specified'
                }
            },
            billDetails: {
                totalAmount: billCalculation.totalAmount,
                monthlyTotal: billCalculation.monthlyTotal,
                pendingDue: billCalculation.due,
                creditBalance: billCalculation.credit,
                totalMonths: billCalculation.totalMonth,
                societyCharges: foundSociety.maintenanceBill.societyCharges,
                repairsAndMaintenance: foundSociety.maintenanceBill.repairsAndMaintenance,
                sinkingFund: foundSociety.maintenanceBill.sinkingFund,
                waterCharges: foundSociety.maintenanceBill.waterCharges,
                insuranceCharges: foundSociety.maintenanceBill.insuranceCharges,
                parkingCharges: foundSociety.maintenanceBill.parkingCharges
            },
            receipt: foundUser.lastPayment || {},
            monthName: date.month,
            date: date.today,
            year: date.year,
            societyResidents: foundUsers,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID // Public key for frontend
        });

    } catch (err) {
        console.error('Bill generation error:', {
            message: err.message,
            user: req.user?.id,
            society: req.user?.societyName
        });
        res.status(500).send("An error occurred while generating bill");
    }
});

// Razorpay Order Creation Route
app.post("/create-razorpay-order", async (req, res) => {
    try {
        // Authentication Checks
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { amount, societyName } = req.body;
        console.log("RazorPay Req Payload",req.body)
        // Validate Amount
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        // Find User and Society
        const foundUser = await user_collection.User.findById(req.user.id);
        const foundSociety = await society_collection.Society.findOne({ 
            societyName: societyName 
        });

        if (!foundUser || !foundSociety) {
            return res.status(404).json({ error: "User or Society not found" });
        }

        // Verify User Status
        if (foundUser.validation !== 'approved') {
            return res.status(403).json({ error: "User not approved" });
        }

        // Create Razorpay Order - This is the key part that was missing
        const orderOptions = {
            amount: Math.round(amount * 100), // Convert to paise (smallest currency unit)
            currency: "INR",
            receipt: `RCPT-${foundUser._id.toString().slice(-6)}-${Date.now()}`,
            notes: {
                societyName: foundSociety.societyName,
                userEmail: foundUser.username
            }
        };

        // Actually create the Razorpay order
        const razorpayOrder = await razorpay.orders.create(orderOptions);

        // Store Order Details for Verification
        await user_collection.User.findByIdAndUpdate(foundUser._id, {
            $set: {
                lastPayment: {
                    date: new Date(),              // Current date for payment
                    amount: amount,                // Payment amount
                    invoice: razorpayOrder.id      // Razorpay order ID as the invoice
                }}
        });

        console.log("UserData:",foundUser)

        // Respond with Order Details
        res.status(200).json({
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Razorpay Order Creation Error:', {
            message: error.message,
            user: req.user?.id,
            stack: error.stack
        });

        res.status(500).json({ 
            error: "Internal Server Error during order creation" 
        });
    }
});

// Payment Verification Route
app.post('/verify-payment', async (req, res) => {
    try {
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature 
        } = req.body;
        console.log("Verify-Payment", req.body)

        // Find User by Current Order
        const user = await user_collection.User.findOne({ 
            'lastPayment.invoice': razorpay_order_id
        });
        console.log(user)

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found for this order' 
            });
        }

        // Verify Payment Signature
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        
        console.log("Generated Signature", generatedSignature)

        // Check Signature Match
        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid payment signature' 
            });
        }

        // Generate Receipt Number
        const receiptNumber = `RCPT-${user._id.toString().slice(-6)}-${Date.now()}`;

        // Update Payment History
        await user_collection.User.findByIdAndUpdate(user._id, {
            $set: {
                makePayment: 0
            }
        });

        res.json({ 
            success: true, 
            message: 'Payment verified and processed successfully',
            receiptNumber: receiptNumber
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during payment verification' 
        });
    }
});

app.get('/payment-success', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            // Retrieve the user details
            const foundUser = await user_collection.User.findById(req.user.id).lean();
            if (!foundUser) {
                return res.redirect('/login');
            }

            // Retrieve the society details
            const foundSociety = await society_collection.Society.findOne({
                societyName: foundUser.societyName
            }).lean();
            if (!foundSociety) {
                return res.status(404).send('Society not found');
            }

            // Calculate payment details
            const lastPayment = foundUser.lastPayment || {};
            const receiptNumber = lastPayment.invoice || 'N/A';
            const totalAmount = lastPayment.amount || 0;

            // Pass all required fields to the template
            res.render('paymentSuccess', {
                message: 'Your payment was processed successfully!',
                redirectUrl: '/bill',
                society: {
                    societyName: foundSociety.societyName
                },
                totalAmount: totalAmount,
                receiptNumber: receiptNumber,
                paymentDate: lastPayment.date || new Date() // Use last payment date or current date
            });
        } catch (error) {
            console.error('Error fetching payment success details:', error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        res.redirect('/login');
    }
});

app.get("/editBill", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.redirect("/login");
    }

    try {
        const foundSociety = await society_collection.Society.findOne({
            societyName: req.user.societyName
        });

        res.render("editBill", {maintenanceBill: foundSociety.maintenanceBill});
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading bill edit page");
    }
});

app.get("/helpdesk", async (req, res) => {
    if (!req.isAuthenticated() || req.user.validation !== 'approved') {
        return res.redirect("/login");
    }

    try {
        if (req.user.isAdmin) {
            const foundUsers = await user_collection.User.find({
                $and: [
                    {"societyName": req.user.societyName}, 
                    {"validation": "approved"}
                ]
            });
            res.render("helpdeskAdmin", {users: foundUsers});
        } else {
            const complaints = req.user.complaints.length ? 
                req.user.complaints : 
                [{
                    'category': 'You have not raised any complaint',
                    'description': 'You can raise complaints and track their resolution by facility manager.'
                }];
            
            res.render("helpdesk", {complaints: complaints});
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading helpdesk");
    }
});

app.get("/complaint", (req, res) => {
    if (req.isAuthenticated() && req.user.validation === 'approved') {
        res.render("complaint");
    } else {
        res.redirect("/login");
    }
});

app.get("/contacts", async (req, res) => {
    try {
        if (req.isAuthenticated() && req.user.validation === 'approved') {
            const userSocietyName = req.user.societyName;
            const foundSociety = await society_collection.Society.findOne({ societyName: userSocietyName });
            
            if (foundSociety) {
                res.render("contacts", { 
                    contact: foundSociety.emergencyContacts, 
                    isAdmin: req.user.isAdmin 
                });
            } else {
                res.redirect("/login");
            }
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/login");
    }
});

// Edit Contacts Route
app.get("/editContacts", async (req, res) => {
    try {
        if (req.isAuthenticated() && req.user.isAdmin) {
            const foundSociety = await society_collection.Society.findOne({ 
                societyName: req.user.societyName 
            });
            
            if (foundSociety) {
                res.render("editContacts", { 
                    contact: foundSociety.emergencyContacts 
                });
            } else {
                res.redirect("/login");
            }
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/login");
    }
});

// Profile Route
app.get("/profile", async (req, res) => {
    try {
        if (req.isAuthenticated() && req.user.validation === 'approved') {
            const foundUser = await user_collection.User.findById(req.user.id);
            
            if (foundUser) {
                const foundSociety = await society_collection.Society.findOne({ 
                    societyName: foundUser.societyName 
                });
                
                res.render("profile", { 
                    resident: foundUser, 
                    society: foundSociety 
                });
            } else {
                res.redirect("/login");
            }
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/login");
    }
});

// Edit Profile Route
app.get("/editProfile", async (req, res) => {
    try {
        if (req.isAuthenticated() && req.user.validation === 'approved') {
            const foundUser = await user_collection.User.findById(req.user.id);
            
            if (foundUser) {
                const foundSociety = await society_collection.Society.findOne({ 
                    societyName: foundUser.societyName 
                });
                
                res.render("editProfile", { 
                    resident: foundUser, 
                    society: foundSociety 
                });
            } else {
                res.redirect("/login");
            }
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/login");
    }
});

// Success Route for Stripe Checkout
app.get('/success', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        const customer = await stripe.customers.retrieve(session.customer);
        
        const foundUser = await user_collection.User.findById(req.user.id);
        
        foundUser.lastPayment.date = new Date(customer.created * 1000);
        foundUser.lastPayment.amount = session.amount_total / 100;
        foundUser.lastPayment.invoice = customer.invoice_prefix;
        
        await foundUser.save();
        
        const transactionDate = new Date(customer.created * 1000).toLocaleString().split(', ')[0];
        
        res.render("success", {
            invoice: customer.invoice_prefix, 
            amount: session.amount_total / 100, 
            date: transactionDate
        });
    } catch (err) {
        console.error(err);
        res.redirect("/home");
    }
});

// Checkout Session Route
app.post('/checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'inr',
                        product_data: {
                            name: req.user.societyName,
                            images: ['https://www.flaticon.com/svg/vstatic/svg/3800/3800518.svg?token=exp=1615226542~hmac=7b5bcc7eceab928716515ebf044f16cd'],
                        },
                        unit_amount: req.user.makePayment * 100,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: "https://esociety-fdbd.onrender.com/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://esociety-fdbd.onrender.com/bill",
        });
        
        res.json({ id: session.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Approve Resident Route
app.post("/approveResident", async (req, res) => {
    try {
        const user_id = Object.keys(req.body.validate)[0];
        const validate_state = Object.values(req.body.validate)[0];
        
        await user_collection.User.updateOne(
            { _id: user_id },
            { $set: { validation: validate_state } }
        );
        
        res.redirect("/residents");
    } catch (err) {
        console.error(err);
        res.redirect("/residents");
    }
});

// Complaint Route
app.post("/complaint", async (req, res) => {
    try {
        const foundUser = await user_collection.User.findById(req.user.id);
        
        if (foundUser) {
            const complaint = {
                'date': date.dateString,
                'category': req.body.category,
                'type': req.body.type,
                'description': req.body.description,
                'status': 'open'
            };
            
            foundUser.complaints.push(complaint);
            await foundUser.save();
            
            res.redirect("/helpdesk");
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/helpdesk");
    }
});

// Close Ticket Route
app.post("/closeTicket", async (req, res) => {
    try {
        const user_id = Object.keys(req.body.ticket)[0];
        const ticket_index = Object.values(req.body.ticket)[0];
        const ticket = `complaints.${ticket_index}`;
        
        const foundUser = await user_collection.User.findById(user_id);
        
        if (foundUser) {
            await user_collection.User.updateOne(
                { _id: user_id },
                { 
                    $set: {
                        [ticket]: {
                            status: 'close',
                            'date': foundUser.complaints[ticket_index].date,
                            'category': foundUser.complaints[ticket_index].category,
                            'type': foundUser.complaints[ticket_index].type,
                            'description': foundUser.complaints[ticket_index].description
                        }
                    }
                }
            );
            
            res.redirect("/helpdesk");
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/helpdesk");
    }
});

// Notice Route
app.post("/notice", async (req, res) => {
    try {
        const foundSociety = await society_collection.Society.findOne({ 
            societyName: req.user.societyName 
        });
        
        if (foundSociety) {
            const notice = {
                'date': date.dateString,
                'subject': req.body.subject,
                'details': req.body.details
            };
            
            foundSociety.noticeboard.push(notice);
            await foundSociety.save();
            
            res.redirect("/noticeboard");
        } else {
            res.redirect("/login");
        }
    } catch (err) {
        console.error(err);
        res.redirect("/noticeboard");
    }
});

// Edit Bill Route
app.post("/editBill", async (req, res) => {
    try {
        await society_collection.Society.updateOne(
            { societyName: req.user.societyName }, 
            { 
                $set: {
                    maintenanceBill: {
                        societyCharges: req.body.societyCharges,
                        repairsAndMaintenance: req.body.repairsAndMaintenance,
                        sinkingFund: req.body.sinkingFund,
                        waterCharges: req.body.waterCharges,
                        insuranceCharges: req.body.insuranceCharges,
                        parkingCharges: req.body.parkingCharges
                    }
                }
            }
        );
        
        res.redirect("/bill");
    } catch (err) {
        console.error(err);
        res.redirect("/bill");
    }
});

// Edit Contacts Route
app.post("/editContacts", async (req, res) => {
    try {
        await society_collection.Society.updateOne(
            { societyName: req.user.societyName }, 
            { 
                $set: {
                    emergencyContacts: {
                        plumbingService: req.body.plumbingService,
                        medicineShop: req.body.medicineShop,
                        ambulance: req.body.ambulance,
                        doctor: req.body.doctor,
                        fireStation: req.body.fireStation,
                        guard: req.body.guard,
                        policeStation: req.body.policeStation
                    }
                }
            }
        );
        
        res.redirect("/contacts");
    } catch (err) {
        console.error(err);
        res.redirect("/contacts");
    }
});

// Edit Profile Route
app.post("/editProfile", async (req, res) => {
    try {
        await user_collection.User.updateOne(
            { _id: req.user.id }, 
            { 
                $set: { 
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber,
                    flatNumber: req.body.flatNumber
                }
            }
        );
        
        if (req.body.address) {
            await society_collection.Society.updateOne(
                { admin: req.user.username }, 
                { 
                    $set: { 
                        societyAddress: {
                            address: req.body.address,
                            city: req.body.city,
                            district: req.body.district,
                            postalCode: req.body.postalCode
                        }
                    }
                }
            );
        }
        
        res.redirect("/profile");
    } catch (err) {
        console.error(err);
        res.redirect("/profile");
    }
});

// New Request Route
app.post("/newRequest", async (req, res) => {
    try {
        const foundSociety = await society_collection.Society.findOne({ 
            societyName: req.body.societyName 
        });
        
        if (foundSociety) {
            await user_collection.User.updateOne(
                { _id: req.user.id }, 
                { 
                    $set: {
                        firstName: req.body.firstName,
                        lastName: req.body.lastName,
                        phoneNumber: req.body.phoneNumber,
                        societyName: req.body.societyName,
                        flatNumber: req.body.flatNumber,
                        validation: 'applied'
                    }
                }
            );
            
            res.redirect("/home");
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            const hrefLink = "/newRequest";
            const secondaryMessage = "Account not created?";
            const hrefSecondaryLink = "/signup";
            const secondaryButton = "Create Account";
            
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch (err) {
        console.error(err);
        res.redirect("/newRequest");
    }
});

// Signup Route
app.post("/signup", async (req, res) => {
    try {
        const foundSociety = await society_collection.Society.findOne({ 
            societyName: req.body.societyName 
        });
        
        if (foundSociety) {
            try {
                const user = await user_collection.User.register({
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                }, req.body.password);

                passport.authenticate("local")(req, res, () => {
                    res.redirect("/home");
                });
            } catch (err) {
                const failureMessage = "Sorry, this email address is not available. Please choose a different address.";
                const hrefLink = "/signup";
                const secondaryMessage = "Society not registered?";
                const hrefSecondaryLink = "/register";
                const secondaryButton = "Register Society";
                
                res.render("failure", {
                    message: failureMessage,
                    href: hrefLink,
                    messageSecondary: secondaryMessage,
                    hrefSecondary: hrefSecondaryLink,
                    buttonSecondary: secondaryButton
                });
            }
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            const hrefLink = "/signup";
            const secondaryMessage = "Society not registered?";
            const hrefSecondaryLink = "/register";
            const secondaryButton = "Register Society";
            
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch (err) {
        console.error(err);
        res.redirect("/signup");
    }
});

app.post("/register", async (req, res) => {
    try {
        const existingSociety = await society_collection.Society.findOne({ 
            societyName: req.body.societyName 
        });
        
        if (!existingSociety) {
            try {
                const user = await user_collection.User.register({
                    validation: 'approved',
                    isAdmin: true,
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                }, req.body.password);

                // Create new society in collection
                const society = new society_collection.Society({
                    societyName: user.societyName,
                    societyAddress: {
                        address: req.body.address,
                        city: req.body.city,
                        district: req.body.district,
                        postalCode: req.body.postalCode
                    },
                    admin: user.username
                });
                
                await society.save();

                passport.authenticate("local")(req, res, () => {
                    res.redirect("/home");
                });
            } catch (err) {
                console.error(err);
                res.redirect("/register");
            }
        } else {
            const failureMessage = "Sorry, society is already registered, Please double-check society name.";
            const hrefLink = "/register";
            const secondaryMessage = "Account not created?";
            const hrefSecondaryLink = "/signup";
            const secondaryButton = "Create Account";
            
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch (err) {
        console.error(err);
        res.redirect("/register");
    }
});

// Login Route
app.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
        if (err) {
            console.error(err);
            return next(err);
        }
        
        if (!user) {
            // Authentication failed
            return res.redirect("/loginFailure");
        }
        
        req.login(user, (err) => {
            if (err) {
                console.error(err);
                return next(err);
            }
            
            return res.redirect("/home");
        });
    })(req, res, next);
});

app.listen(
    process.env.PORT || 3000, 
    console.log("Server started")
);