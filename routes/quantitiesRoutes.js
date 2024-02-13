const express = require("express");
const router = express.Router();
const {
  getMotor,
  getQuantities,
} = require("../controllers/quantitiesController");

router.post("/", getQuantities);
router.post("/motor",getMotor);
// router.get("/calculate", calculateQuantity);

module.exports = router;
