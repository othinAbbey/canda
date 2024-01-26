const express = require('express');
const router = express.Router();
const {addMat} = require('../controllers/materialsController');

//Adding Materials to the database
router.post('/add', addMat);

module.exports = router;