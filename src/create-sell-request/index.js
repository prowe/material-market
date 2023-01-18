import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamoDBClient);

const ZEROS = new Array(32).fill(0).join('');

function leftPadPricePerUnit(pricePerUnit) {
  // since we are using string concatination, we want to left pad this so that we get a sortable string
  return (ZEROS + pricePerUnit.toString(16)).slice(-32);
}

function buildItemForRequest({material, quantity, pricePerUnit}) {
  const paddedPrice = leftPadPricePerUnit(pricePerUnit);
  const requestId = randomUUID();
  return {
    material,
    sk: `${paddedPrice}-${requestId}`,
    quantity,
    pricePerUnit
  }
}

export async function handler(event) {
  console.log('event: ', event);
  const sellRequest = JSON.parse(event.body);

  await documentClient.put({
    TableName: process.env.TABLE_NAME,
    Item: buildItemForRequest(sellRequest)
  });

  return {
    statusCode: 200,
    body: JSON.stringify(sellRequest),
    headers: {
      'Content-Type': 'application/json'
    }
  };
}