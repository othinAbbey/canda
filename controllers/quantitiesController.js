const express = require('express');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function calculateQuantity(req, res) {
    try {
      console.log("Received request:", req.body);

      const selectedBrick = await prisma.mat.findUnique({
        where: {
          name:brick,
        },
      });

      console.log("Selected Brick:", selectedBrick);

      if (!selectedBrick) {
        console.log("Brick not found");
        return res.status(400).json({ message: "Brick not found" });
      }

      const selectedStructure = await prisma.structures.findUnique({
        where: {
          name: req.body.structure,
        },
      });

      console.log("Selected Structure:", selectedStructure);

      if (!selectedStructure) {
        console.log("Structure not found");
        return res.status(400).json({ message: "Structure not found" });
      }

      // Rest of your code for calculating quantity

      console.log("Quantity calculated successfully");

      res.status(200).json({ message: "Quantity calculated successfully" });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = {
  calculateQuantity
}
