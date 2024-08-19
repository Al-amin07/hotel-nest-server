require('dotenv').config()
const express = require('express')
const app = express()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const multer = require('multer')
const port = process.env.PORT || 8000
const path = require('path')
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://hotelnest-5ebe9.web.app'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads')
  },
  filename: function (req, file, cb) {
    console.log('In F', file)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})

const upload = multer({ storage: storage })

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pekpvn6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    const roomsCollection = await client.db('hotelNest').collection('rooms')
    const usersCollection = await client.db('hotelNest').collection('users')
    const bookingsCollection = await client.db('hotelNest').collection('bookings')

    // Admin Verification
    const verifyAdmin = async (req, res, next) => {
      const { email } = req.user;
      const data = await usersCollection.findOne({ email })
      if (data && data.role === 'admin') {
        next()
      } else {
        return res.status(401).send({ message: 'Unauthorized Access!!!' })
      }
    }
    const verifyHost = async (req, res, next) => {
      const { email } = req.user;
      const data = await usersCollection.findOne({ email })
      if (data && data.role === 'host') {
        next()
      } else {
        return res.status(401).send({ message: 'Unauthorized Access!!!' })
      }
    }

    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const totalRoom = await roomsCollection.countDocuments();
      const totalUser = await usersCollection.countDocuments();
      const totalBookings = await bookingsCollection.find({}, { projection: { totalPrice: 1, time: 1 } }).toArray();
      const totalPrice = totalBookings.reduce((sum, booking) => sum + booking.totalPrice, 0)
      const chartData = totalBookings.map(booking => {
        const day = new Date(booking.time).getDay()
        const month = new Date(booking.time).getMonth()
        return [`${day}/${month}`, booking.totalPrice]
      })
      chartData.unshift(['Day', 'Sales'])
      res.send({ totalRoom, totalBooking: totalBookings.length, totalUser, totalPrice, chartData })
    })
    app.get('/host-stat', verifyToken, verifyHost, async (req, res) => {
      const { email } = req.user
      const totalRoom = await roomsCollection.countDocuments({ 'host.email': email });

      const totalBookings = await bookingsCollection.find({ 'host.email': email }, { projection: { totalPrice: 1, time: 1 } }).toArray();
      const totalPrice = totalBookings.reduce((sum, booking) => sum + booking.totalPrice, 0)
      const chartData = totalBookings.map(booking => {
        const day = new Date(booking.time).getDay()
        const month = new Date(booking.time).getMonth()
        return [`${day}/${month}`, booking.totalPrice]
      })
      chartData.unshift(['Day', 'Sales'])
      res.send({ totalRoom, totalBooking: totalBookings.length, totalPrice, chartData })
    })
    app.get('/guest-stat',verifyToken, async (req, res) => {
     const { email} = req.user
      const totalBookings = await bookingsCollection.find({'guest.email': email}, { projection: { totalPrice: 1, time: 1 } }).toArray();
      const totalPrice = totalBookings.reduce((sum, booking) => sum + booking.totalPrice, 0)
      const chartData = totalBookings.map(booking => {
        const day = new Date(booking.time).getDay()
        const month = new Date(booking.time).getMonth()
        return [`${day}/${month}`, booking.totalPrice]
      })
      chartData.unshift(['Day', 'Sales'])
      res.send({  totalBooking: totalBookings.length,  totalPrice, chartData })
    })

    // Users

    app.get('/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result)
    })

    app.put('/user', async (req, res) => {
      const userData = req.body;
      const query = { email: userData?.email }
      const isExist = await usersCollection.findOne(query)
      console.log(isExist)
      if (isExist) return res.send({ message: 'User Already Exist' })
      const updatedDoc = {
        $set: {
          ...userData
        }
      }
      const result = await usersCollection.insertOne(userData, updatedDoc)
      res.send(result)
    })

    app.patch('/role/:email', async (req, res) => {
      const email = req.params.email;
      const { role, time } = req.body;
      const updatedDoc = {
        $set: {
          role,
          time
        }
      }
      const result = await usersCollection.updateOne({ email }, updatedDoc)
      res.send(result)
    })

    app.patch('/role-request/:email', async (req, res) => {
      const { email } = req.params;
      const updatedDoc = {
        $set: {
          status: 'Requested'
        }
      }
      const result = await usersCollection.updateOne({ email }, updatedDoc)
      res.send(result)
    })


    // Payment and Booking
    app.post("/create-payment-intent", async (req, res) => {
      const { totalPrice } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(totalPrice * 100),
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get('/gallery', async(req, res) => {
      const result = await roomsCollection.find({}, {projection: {image: 1}}).toArray()
      res.send(result)
    })

    app.post('/booking', async (req, res) => {
      const { bookingInfo } = req.body;
      const result = await bookingsCollection.insertOne(bookingInfo)
      res.send(result)
    })

    app.get('/my-bookings/:email', async (req, res) => {
      const email = req.params.email;
      const query = { 'guest.email': email }
      const result = await bookingsCollection.find(query).toArray();
      res.send(result)
    })
    app.get('/manage-bookings/:email', async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email }
      const result = await bookingsCollection.find(query).toArray();
      res.send(result)
    })

    app.delete('/booking/:id', async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    app.patch('/room-update/:id', async (req, res) => {
      const id = req.params.id;
      const { booked } = req.body
      const options = { upsert: true }
      const updatedDoc = {
        $set: {
          booked
        }
      }
      const result = await roomsCollection.updateOne({ _id: new ObjectId(id) }, updatedDoc, options)
      res.send(result)
    })

    // Role
    app.get('/role/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email })
      res.send(result.role)
    })

    // All Rooms
    app.get('/rooms', async (req, res) => {
      const category = req.query.category;
      const start = parseInt(req.query.start);
      const skipItem = 10 * (start - 1)
      console.log(category)
      let query = {};
      if (category && category !== 'null') query.category = category
      const result = await roomsCollection.find(query).limit(10).skip(skipItem).toArray();
      const totalResult = await roomsCollection.countDocuments(query);
      res.send({ result, totalResult })
    })

    //Get 8 Room 
    app.get('/rooms8', async (req, res) => {
      const result = await roomsCollection.find().limit(5).toArray();
      res.send(result)
    })

    app.get('/room/:id', async (req, res) => {
      const id = req.params.id;
      const result = await roomsCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    app.post('/room', async (req, res) => {
      const roomData = req.body;
      const result = await roomsCollection.insertOne(roomData)
      res.send(result)
    })

    app.get('/my-listing/:email', async (req, res) => {
      const email = req.params.email;
      const result = await roomsCollection.find({ 'host.email': email }).toArray()
      res.send(result)
    })

    app.delete('/room/:id', async (req, res) => {
      const id = req.params.id;
      const result = await roomsCollection.deleteOne({ _id: new ObjectId(id) })
      res.send(result)
    })

    // Upload Image
    app.post('/upload', upload.single('avatar'), async (req, res) => {
      res.send(req.file.path)
    })
    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
