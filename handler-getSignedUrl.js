const AWS = require('aws-sdk');
const https = require('https');
const s3 = new AWS.S3();

async function getPresignedUrl(filename) 
{
  try {
    const url = await s3.getSignedUrlPromise('putObject', {
      Bucket: process.env.S3_BUCKET,
      Key: filename, // File name could come from queryParameters
    });
    return(url)
  }
  catch (err) {
    console.log('Error getting presigned url from AWS S3:', err);
    return false
  }
}

// create a function that read in dynamoDB and return if presigned url exists

async function checkIfPaymentHashExist(payment_hash, date) {
  try {
    console.log("in checkIfPaymentHashExist " + payment_hash + " " + date)
    const dynamoDB = new AWS.DynamoDB.DocumentClient();
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: {
        payment_hash: payment_hash,
        date: date
      },
    };
    const data = await dynamoDB.get(params).promise();
    if (data.Item) {
      //return data.Item;
      return true
    }
    return false;
  } catch (err) {
    console.log('Error getting payment hash from DynamoDB:', err);
    return false;
  }
} 

// Create a function that delete a presigned url from dynamoDB
async function deletePresignedUrl(payment_hash, date) {
  try {
    console.log("in deletePresignedUrl " + payment_hash + " " + date)
    const dynamoDB = new AWS.DynamoDB.DocumentClient();
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: {
        payment_hash: payment_hash,
        date: date
      },
    };
    const data = await dynamoDB.delete(params).promise();
    if (data.Item) {
      return true
    }
    return false;
  } catch (err) {
    console.log('Error deleting presigned url from DynamoDB:', err);
    return false;
  }
}

module.exports.getPresignedUrl = async function(event, context, callback) {

  
  try {
    console.log("event " + event.body)
    const body = Buffer.from(event.body, 'base64').toString();
    console.log("body " + body)
    const bodyJson = JSON.parse(body);
    console.log("bodyJson " + bodyJson)
    const payment_hash = bodyJson.payment_hash;
    const filename = bodyJson.filename;
    const date = bodyJson.date;
    const paymentExist = await checkIfPaymentHashExist(payment_hash, date)
    console.log(paymentExist)
    if (!paymentExist) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: 'Invoice already used'
        })
      }
    }
    
    const options = {
      hostname: process.env.LNBITS_HOST,
      port: 443,
      path: '/api/v1/payments/' + payment_hash,
      method: 'GET',
      headers: {
        'X-Api-Key': process.env.LNBITS_API_INVOICE_KEY,
        'Content-Type': 'application/json',
      }
    }
// pass filename to https request

    const requestPromise = new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let data = '';
        res.on('data', d => {
          process.stdout.write(d);
          data += d;
        });
        res.on('end', () => {
          resolve(data);
        });
      });
      req.on('error', error => {
        reject(error);
      });
      req.write(JSON.stringify({}));
      req.end();
    });

    const data = await requestPromise;
    const responseData = JSON.parse(data);
          
    if (responseData.paid) {
      console.log("in paid")
      presigned_url = await getPresignedUrl(filename);
      const deleteStatus = await deletePresignedUrl(payment_hash, date)
      console.log("deleteStatus " + deleteStatus)
      console.log("presigned_url " + presigned_url )
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          presigned: presigned_url
        })
      }
    }
    else {
      console.log("in not paid")
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: 'Invoice not paid'
        })
      }
    }
  } catch (err) {
    console.log('Error getting invoice from lnbits:', err);
    console.log(err.syscall)
    message = 'General error'
    if (err.syscall === 'getaddrinfo') {
      message = 'Cannot connect to lnbits'

    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        message: message
      })
    }
  }
};