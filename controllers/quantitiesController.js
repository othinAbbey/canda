const express = require("express");
const bodyParser = require("body-parser");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function getQuantities(req, res) {
  try {
    const { structure, brick, length, height, width } = req.body;
    const [lengthMeters, heightMeters, widthMeters] = [
      length,
      height,
      width,
    ].map((value) => value / 1000);

    console.log(structure);
    console.log(brick);
    console.log(length);
    console.log(height);
    console.log(width);

    console.log("Length Meters:", lengthMeters);
    console.log("Height Meters:", heightMeters);
    console.log("Width Meters:", widthMeters);

    // const selectedStructure = await prisma.structures.findUnique({
    //   where: {
    //     name: structure,
    //   },
    // });

    // console.log("Selected Structure:", selectedStructure);

    // Find the selected structure
    const selectedStructure = await prisma.structures.findUnique({
      where: {
        name: structure,
      },
      include: {
        materials: true, // Include the associated materials
      },
    });

    console.log("Selected Structure:", selectedStructure);

    ///////////////////////////////////////////////////////

    if (!selectedStructure) {
      return res.status(400).json({ message: "Structure not found" });
    }

    const dimensions = await prisma.dimensions.findUnique({
      where: {
        id: selectedStructure.dimensionsId,
      },
    });

    if (!dimensions) {
      return res.status(400).json({ message: "Dimensions not found" });
    }

    const materialsUsed = selectedStructure.materials;

    console.log("Materials Used:", materialsUsed);

    const [brickLengthMeters, brickWidthMeters, brickHeightMeters] = [
      dimensions.length,
      dimensions.width,
      dimensions.height,
    ].map((value) => value / 1000);

    const numberOfBricks = Math.ceil(
      (lengthMeters * heightMeters) / (brickLengthMeters * brickHeightMeters)
    );
    console.log("Number of Bricks:", numberOfBricks);
    res.status(200).json({
      numberOfBricks: numberOfBricks,
      materialsUsed: {
        structure: structure,
        materials: materialsUsed,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  // calculateQuantity,
  getQuantities,
};
