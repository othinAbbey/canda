const express = require('express');
const router = express.Router();
const {calculateQuantity} = require('../controllers/quantitiesController');

router.post('/', calculateQuantity);
router.get('/calculate', calculateQuantity)

module.exports = router;