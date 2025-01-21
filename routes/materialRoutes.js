const express = require('express');
const router = express.Router();
const {addMat,getAllMaterials, getAllProducts} = require('../controllers/materialsController');


//Adding Materials to the database
router.post('/add', addMat);
router.get('/allmats', getAllMaterials);
router.get('/pros', getAllProducts)

module.exports = router;