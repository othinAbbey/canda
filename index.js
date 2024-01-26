require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

// Import Routes
const userRoutes = require('./routes/userRoutes');
<<<<<<< HEAD
const quantitiesRoutes = require('./routes/quantitiesRoutes');

app.use('/user', userRoutes);
app.use('/quantities', quantitiesRoutes);
=======
const materialRoutes = require('./routes/materialRoutes');
app.use('/user', userRoutes);
app.use('/materials', materialRoutes);
>>>>>>> 5fc3458375358663f3debc70751b0b1bec279d06

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}/`);
});
