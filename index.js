require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const port =process.env.PORT;
app.use(cors());
app.use(express.json());

// Import Routes
const userRoutes = require('./routes/userRoutes');
app.use('/user', userRoutes);

app.listen(port, () => {
 
    console.log(`Server is running at http://localhost:${port}/`);
});