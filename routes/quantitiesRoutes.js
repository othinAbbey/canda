const express = require('express');
const router = express.Router();
const {calculateQuantity,getQuantities} = require('../controllers/quantitiesController');

router.post('/',getQuantities);
router.get('/calculate', calculateQuantity)

module.exports = router;