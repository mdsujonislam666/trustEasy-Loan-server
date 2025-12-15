const express = require('express')
const cors = require('cors');
require('dotenv').config();
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;


const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require('./trusteasy-loan-firebase-adminsdk.json');
const { access } = require('fs/promises');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}


// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  // console.log('headers in the middleware', req.headers.authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('decoded token', decoded);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.skswfst.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('trusteasy_loan_db');
    const usersCollection = db.collection('users');
    const applicationCollection = db.collection('loanApplications');
    const paymentCollection = db.collection('payments');
    const loanCollection = db.collection('loans');

    // loans related apis
    app.post('/loans', async (req, res) => {
      const loans = req.body;
      loans.createdAt = new Date();
      const result = await loanCollection.insertOne(loans);
      res.send(result);
    })

    app.get('/availableLoans', async (req, res) => {
      const cursor = loanCollection.find({ showHome: "On" }).sort({ createdAt: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/allLoans', async (req, res) => {
      const cursor = loanCollection.find().sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })
    app.get('/loan-details/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await loanCollection.findOne(query);
      res.send(result);
    })

    // app.get('/products/:id', async (req, res) => {
    //   const id = req.params.id;
    //   const objectId = new ObjectId(id)
    //   const filter = { _id: objectId }
    //   const result = await productsCollection.findOne(filter);
    //   res.send(result);
    // })



    // users related apis
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = user.role;
      user.createdAt = new Date();
      const email = user.email;

      const borrowerExists = await usersCollection.findOne({ email })

      if (borrowerExists) {
        return res.send({ message: 'borrower exists' })
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    })

    app.get('/users', async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/users/:id', verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          status: status
        }
      }
      const result = await usersCollection.updateOne(query, updatedDoc);
      res.send(result);
    })

    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role });
    });


    // loanApplication api

    app.get('/loanApplications', verifyFBToken, async (req, res) => {
      const query = {}
      const { email } = req.query;

      if (email) {
        query.email = email;

        // checkout email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }

      const options = { sort: { createdAt: -1 } }

      const cursor = applicationCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/loanApplications/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await applicationCollection.findOne(query);
      res.send(result);
    })

    app.post('/loanApplications', async (req, res) => {
      const application = req.body;
      application.createdAt = new Date();
      const result = await applicationCollection.insertOne(application);
      res.send(result);
    })

    app.delete('/loanApplications/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await applicationCollection.deleteOne(query);
      res.send(result);
    })


    // payment related apis

    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.loanTitle
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          applicationId: paymentInfo.applicationId,
          loanName: paymentInfo.loanTitle
        },
        customer_email: paymentInfo.userEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      console.log(session);
      res.send({ url: session.url })
    })

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log('session retrieve', session);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }

      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({ message: 'already exists', transactionId, trackingId: paymentExist.trackingId })
      }

      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.applicationId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            FeeStatus: 'paid',
            transactionId: session.payment_intent,
            trackingId: trackingId
          }
        }
        const result = await applicationCollection.updateOne(query, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          applicationId: session.metadata.applicationId,
          loanName: session.metadata.loanName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }

        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({ success: true, modifyApplication: result, transactionId: session.payment_intent, trackingId: trackingId, paymentInfo: resultPayment })
        }
      }

      res.send({ success: false })
    })

    // old
    // app.post('/create-checkout-session', async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100;
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         // Provide the exact Price ID (for example, price_1234) of the product you want to sell
    //         price_data: {
    //           currency: 'USD',
    //           unit_amount: amount,
    //           product_data: {
    //             name: paymentInfo.loanTitle
    //           }
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.userEmail,
    //     mode: 'payment',
    //     metadata: {
    //       applicationId: paymentInfo.applicationId
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   })
    //   console.log(session);
    //   res.send({ url: session.url })
    // })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})