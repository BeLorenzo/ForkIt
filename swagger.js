const swaggerAutogen = require('swagger-autogen')({openapi: '3.0.0'});

const doc = {
    info: {
        title: 'FORKIT API',
        description: 'Swagger delle api progetto ForkIt'
    },
    host: 'localhost:3001'
};

const outputFile = './swagger.json';
const inputFiles = ['./main.js'];


swaggerAutogen(outputFile, inputFiles, doc);