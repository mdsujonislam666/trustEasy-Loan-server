const express = require('express')
const cors = require('cors');
require('dotenv').config();
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;


// middleware
app.use(express.json());
app.use(cors());

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
    const applicationCollection = db.collection('loanApplications');


    // loanApplication api

    app.get('/loanApplications', async (req, res) => {
      const query = {}
      const { email } = req.query;
      if (email) {
        query.email = email;
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
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data:{
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.loanTitle
              }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: 'payment',
        metadata: {
          applicationId: paymentInfo.applicationId
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      console.log(session);
      res.send({ url: session.url })
    })

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