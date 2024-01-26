const express = require('express');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function getQuantities(req,res) {
  try{
    // console.log("Received request:", req.body);

    const selectedBrick = await prisma.mat.findUnique({
      where: {
        name: req.body.brick,
      },
    });
    console.log("Selected Brick:", selectedBrick);


    if(selectedBrick){
      
    const dimensions = await prisma.dimensions.findUnique({
      where: {
        id: selectedBrick.dimensionsId,
      }
    }
    )
    console.log("Dimensions:", dimensions);
    const numberOfBricks = (req.body.length * req.body.width) / (dimensions.length * dimensions.width);
    console.log("Number of bricks:", numberOfBricks);
    res.send({numberOfBricks: numberOfBricks})
    // res.status(200).json({ message: "Quantity calculated successfully", numberOfBricks: numberOfBricks });
    } else {
      console.log("Dimensions not found");
      console.log("Brick not found");
      return res.status(400).json({ message: "Brick not found" });
    }

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }

}

async function calculateQuantity(req, res,selectedBrick) {
    try {
     
      const selectedStructure = await prisma.structures.findUnique({
        where: {
          name: selectedBrick.name,
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
  calculateQuantity,
  getQuantities
}
