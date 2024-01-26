require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

// Import Routes
const userRoutes = require('./routes/userRoutes');
const quantitiesRoutes = require('./routes/quantitiesRoutes');
const materialRoutes = require('./routes/materialRoutes');

app.use('/user', userRoutes);
app.use('/quantities', quantitiesRoutes);
app.use('/materials', materialRoutes);

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}/`);
});
