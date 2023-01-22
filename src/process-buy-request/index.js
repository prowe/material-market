// @ts-check

/**
 * @typedef { import("aws-lambda").KinesisStreamRecord } KinesisStreamRecord
 * @typedef { import("aws-lambda").KinesisStreamEvent } KinesisStreamEvent
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamoDBClient);

/**
 * Convert the kinesis stream record into the original Buy Request
 * @param {KinesisStreamRecord} record 
 * @returns {import("../..").BuyRequestItem?}
 */
function convertKinesisRecordToBuyRequest(record) {
  const buffer = Buffer.from(record.kinesis.data, 'base64');

  const parsedEvent = JSON.parse(buffer.toString('utf-8'));
  console.log('parsedEvent: ', JSON.stringify(parsedEvent, undefined, 2));
  const newImage = parsedEvent.dynamodb.NewImage;
  if (!newImage) {
    return null;
  } 
  // @ts-ignore
  return unmarshall(newImage);
}

/**
 * Find the BuyRequest record that is being sold for the best price
 * @param {string} material 
 * @param {number} maxPricePerUnit
 * @returns {Promise<import("../..").SellRequestItem?>}
 */
async function findBestPriceSellRequestForMaterial(material, maxPricePerUnit) {
  const result = await documentClient.query({
    TableName: process.env.SELL_REQUESTS_TABLE_NAME,
    KeyConditionExpression: 'material = :material',
    FilterExpression: 'pricePerUnit <= :maxPricePerUnit',
    ExpressionAttributeValues: {
      ":material": material,
      ":maxPricePerUnit": maxPricePerUnit
    },
    Limit: 1
  });
  // @ts-ignore
  return (result?.Items && result.Items[0]) ?? null;
}

/**
 * Determines if this buy request is still needing more fills
 * @param {import("../..").BuyRequestItem} request
 * @returns boolean
 */
function isBuyRequestFulfilled(request) {
  return request.quantity <= request.filledQuantity;
}

/**
 * 
 * @param {KinesisStreamRecord} record 
 */
async function processRecord(record) {
  const buyRequest = convertKinesisRecordToBuyRequest(record);
  console.log("Processing buy request: ", JSON.stringify(buyRequest));
  if (!buyRequest) {
    return;
  }
  if (isBuyRequestFulfilled(buyRequest)) {
    console.warn("Request is fulfilled");
    return;
  }
  const bestPriceSellRequest = await findBestPriceSellRequestForMaterial(buyRequest.material, buyRequest.pricePerUnit);
  if (!bestPriceSellRequest) {
    console.warn("Cannot find any sellers");
    return;
  }
  console.log("Best price: ", JSON.stringify(bestPriceSellRequest));

  // compare prices, decrement things
  const askedQuantity = buyRequest.quantity - buyRequest.filledQuantity;
  const claimedQuantity = Math.min(askedQuantity, bestPriceSellRequest?.quantity);
  const sellExausted = bestPriceSellRequest.quantity === claimedQuantity;
  const totalPrice = claimedQuantity * bestPriceSellRequest.pricePerUnit;

  await documentClient.executeTransaction({
    TransactStatements: [
      {
        Statement: `
          UPDATE "${process.env.BUY_REQUESTS_TABLE_NAME}" 
          SET filledQuantity = filledQuantity + ?
          SET filledTotalCost = filledTotalCost + ?
          WHERE id = ?`,
        Parameters: [claimedQuantity, totalPrice, buyRequest.id]
      },
      (sellExausted ?
        {
          Statement: `
            DELETE FROM "${process.env.SELL_REQUESTS_TABLE_NAME}" 
            WHERE id = ?`,
          Parameters: [bestPriceSellRequest.id]
        } : {
          Statement: `
            UPDATE "${process.env.SELL_REQUESTS_TABLE_NAME}" 
            SET quantity = quantity - ?
            WHERE id = ?`,
          Parameters: [claimedQuantity, bestPriceSellRequest.id]
      })
    ]
  });
}

/**
 * 
 * @param {KinesisStreamEvent} event 
 * @returns 
 */
export async function handler(event) {
  console.log(JSON.stringify(event, undefined, 2));
  for (let r of event.Records) {
    await processRecord(r);
  }
  return {};
};


