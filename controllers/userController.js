const express = require('express');
const bodyParser = require('body-parser');
// const bcrypt = require('bcrypt');
const bcrypt = require('bcryptjs');

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const saltRounds = 10;



async function signUp(req , res){
     if (req.method !== 'POST') {
        return res.status(405).end(); // Method Not Allowed
      }
    try{
        //check if usere already exists
        const userExists = await prisma.user.findUnique({
            where: {
                email: req.body.email,
            }
        })
        //throwing error if user exists
        if(userExists){
            return res.status(400).json({message: "User already exists, Kindly Login"});
        }
        const {firstName, lastName, email, password, phone} = req.body;
        if (!email || !password || !firstName || !lastName || !phone) {
            return res.status(400).json({ message: "All fields are required" });
           
        }
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const user = await prisma.user.create({
            data: {
                firstName: firstName,
                lastName: lastName,
                email: email,
                phone: phone,
                password: hashedPassword,
                // region: "region",
                // accountType: "accountType",
            }
        })

        
        res.json({message: "User created successfully , proceed to login"});

        
    }
    catch(error){
        console.log(error);
    }

}

async function login(req, res) {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({
            where: {
                email: email
            }
        });

        if (user) {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // Return a success response
                return res.json(user);
            } else {
                // Incorrect password
                return res.status(400).json({ message: "Incorrect password or email" });
            }
        } else {
            // User does not exist
            return res.status(400).json({ message: "User does not exist, Kindly signup" });
        }
    } catch (error) {
        // Handle other errors
        console.log(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

module.exports = {
    signUp,
    login
}