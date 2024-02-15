const express = require('express');
const router = express.Router();
const {addMat,getAllMaterials} = require('../controllers/materialsController');


//Adding Materials to the database
router.post('/add', addMat);
router.get('/all', getAllMaterials);

module.exports = router;