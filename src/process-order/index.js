// @ts-check
/**
 * @typedef {import("../..").OrderDynamoItem} OrderDynamoItem
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamoDBClient);

/**
 * Convert the kinesis stream record into the original Order
 * @param {import("aws-lambda").KinesisStreamRecord} record 
 * @returns {OrderDynamoItem?}
 */
function convertKinesisRecordToOrder(record) {
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
 * @param {OrderDynamoItem} kinesisOrder
 * @returns {Promise<OrderDynamoItem?>}
 */
async function reloadOrder({material, sk}) {
  const result = await documentClient.get({
    TableName: process.env.TABLE_NAME,
    Key: {material, sk},
    ConsistentRead: true,
  });
  // @ts-ignore
  return result.Item ?? undefined; 
}

/**
 * Find the Sell order record that is best for the given buy
 * @param {OrderDynamoItem} buyOrder 
 * @returns {Promise<OrderDynamoItem?>}
 */
async function findBestSellOrderForBuy({material, pricePerUnit}) {
  const result = await documentClient.query({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: "material = :material and begins_with(sk, :typePrefix)",
    FilterExpression: "pricePerUnit <= :pricePerUnit",
    ExpressionAttributeValues: {
      ":material": material,
      ":typePrefix": 'Sell:',
      ":pricePerUnit": pricePerUnit,
    },
    Limit: 1,
    ConsistentRead: true
  });
  // @ts-ignore
  return (result?.Items && result.Items[0]) ?? null;
}

/**
 * Find the Buy order record that is best for the given Sell
 * @param {OrderDynamoItem} buyOrder 
 * @returns {Promise<OrderDynamoItem?>}
 */
 async function findBestBuyOrderForSell({material, pricePerUnit}) {
  const result = await documentClient.query({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: "material = :material and begins_with(sk, :typePrefix)",
    FilterExpression: "pricePerUnit >= :pricePerUnit",
    ExpressionAttributeValues: {
      ":material": material,
      ":typePrefix": 'Buy:',
      ":pricePerUnit": pricePerUnit,
    },
    ScanIndexForward: false,
    Limit: 1,
    ConsistentRead: true
  });
  // @ts-ignore
  return (result?.Items && result.Items[0]) ?? null;
}

/**
 * 
 * @param {OrderDynamoItem} order 
 * @returns {Promise<{buyOrder: OrderDynamoItem?, sellOrder: OrderDynamoItem?}>}
 */
async function findMatchingOrders(order) {
  if (order.type === 'Buy') {
    return {
      buyOrder: order,
      sellOrder: await findBestSellOrderForBuy(order)
    };
  } else {
    return {
      buyOrder: await findBestBuyOrderForSell(order),
      sellOrder: order
    };
  }
}

/**
 * 
 * @param {OrderDynamoItem} order 
 * @param {number} claimedQuantity
 */
function buildTransactionOperationForOrder({quantity, material, sk}, claimedQuantity) {
  if (claimedQuantity === quantity) {
    return {
      Statement: `
        DELETE FROM "${process.env.TABLE_NAME}" 
        WHERE material = ? and sk = ?`,
      Parameters: [material, sk]
    };
  } else {
    return {
      Statement: `
        UPDATE "${process.env.TABLE_NAME}" 
        SET quantity = quantity - ?
        WHERE material = ? and sk = ?`,
      Parameters: [claimedQuantity, material, sk]
    };
  }
}

/**
 * 
 * @param {import("aws-lambda").KinesisStreamRecord} record 
 */
async function processRecord(record) {
  const kinesisOrder = convertKinesisRecordToOrder(record);
  if (!kinesisOrder) {
    return;
  }
  const order = await reloadOrder(kinesisOrder);
  console.log("Processing order: ", JSON.stringify(order));
  if (!order) {
    return;
  }
  const {buyOrder, sellOrder} = await findMatchingOrders(order);
  if (!buyOrder || !sellOrder) {
    console.warn("Unable to match up order", order);
    return;
  }
  console.log('Found matching orders: ', JSON.stringify({buyOrder, sellOrder}));
  const claimedQuantity = Math.min(buyOrder.quantity, sellOrder.quantity);

  const transactStatements = [
    buildTransactionOperationForOrder(buyOrder, claimedQuantity),
    buildTransactionOperationForOrder(sellOrder, claimedQuantity)
  ];
  try {
    await documentClient.executeTransaction({
      TransactStatements: transactStatements
    });
  } catch (e) {
    e.TransactStatements = transactStatements;
    throw e;
  }
  console.log('completed order match');
}

/**
 * 
 * @param {import("aws-lambda").KinesisStreamEvent} event 
 */
export async function handler(event) {
  // console.log(JSON.stringify(event, undefined, 2));
  for (let r of event.Records) {
    await processRecord(r);
  }
}


