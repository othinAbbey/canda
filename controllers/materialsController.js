const express = require('express');
const router = express.Router();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient()


//Adding Materials to the database
async function addMat(req, res){
    if(req.method !== 'POST'){
        return res.status(405).end().json({message: "Page not found"});
    }
    try{
        console.log('Request Body:', req.body);
        //check if material already exists
        const matExists = await prisma.material.findUnique({
            where: {
                material: req.body.material,
            }
        })
        const {material, description, rate} = req.body;
        //Throwing error if material exists
        if(matExists){
            return res.status(400).json({message: "Material already exists"});
        } 
        
        //Check if all fields are filled
        if (!material || !description || !rate){
            console.log(req.body);
            return res.status(400).json({message: "All fields are required"})
        }
        //Adding material to the database
        const materials = await prisma.material.create({
            data: {
                material: material,
                description: description,
                rate: rate,
            }
        })
        //Returning success message
        res.json({message: "Material added successfully"});
    } catch(error) {
        console.log(error);
        // return res.status(500).json({message: "failed to create material"})
    }
}

//get all materials from the database

async function getAllMaterials(req, res) {
    if(req.method !== 'GET'){
        return res.status(405).end();
    }
    try{
        const materials = await prisma.material.findMany();
        res.json(materials) 
     } catch(error){
        console.log(error);
        res.status(500).json({message: "Failed to get materials"})
     }
}


async function getAllProducts(req,res){
    if(req.method !== "GET"){
        return res.status(405).end();
    }
    try{
        const products = await prisma.product.findMany({
            include: {
                supplier: true,
                // locationName: true,
                // parish: true,
                // material: true,
                // units: true,
                // rateDetails:{
                //     include:{
                //     // material:true
                //     }
                // }
            }
        });
        res.json(products)
    } catch(error){
        console.log(error)
        return res.status(500).json({message:"Failed to get products"})
    }
}
module.exports = {
    addMat,
    getAllMaterials,
    getAllProducts
}