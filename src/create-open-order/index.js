// @ts-check

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamoDBClient);

/**
 * 
 * @param {number} pricePerUnit 
 * @returns string
 */
function leftPadPricePerUnit(pricePerUnit) {
    // since we are using string concatination, we want to left pad this so that we get a sortable string
    return pricePerUnit.toFixed(0).padStart(9, '0');
}

/**
 * 
 * @param {import("../..").OrderRequest} request 
 * @returns {import("../..").OrderDynamoItem}
 */
function buildItemForRequest(request) {
    const paddedPrice = leftPadPricePerUnit(request.pricePerUnit);
    const requestId = randomUUID();
    return {
      ...request,
      sk: `${request.type}:${paddedPrice}:${requestId}`,
    };
}

/**
 * 
 * @param {import('aws-lambda').APIGatewayProxyEvent} event 
 * @returns { Promise<import('aws-lambda').APIGatewayProxyResult> }
 */
export async function handler(event) {
    console.log('event: ', event);
    if (!event.body) {
        throw new Error('Need a body');
    }
    const orderRequest = JSON.parse(event.body);
  
    await documentClient.put({
      TableName: process.env.TABLE_NAME,
      Item: buildItemForRequest(orderRequest)
    });
  
    return {
      statusCode: 200,
      body: JSON.stringify(orderRequest),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }
