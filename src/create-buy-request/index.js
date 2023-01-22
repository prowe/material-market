import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamoDBClient);

function buildItemForRequest({material, quantity, pricePerUnit}) {
  return {
    id: randomUUID(),
    material,
    quantity,
    pricePerUnit,
    filledQuantity: 0,
    filledTotalCost: 0,
  };
}

export async function handler(event) {
  console.log('event: ', event);
  const buyRequest = JSON.parse(event.body);

  const item = buildItemForRequest(buyRequest);
  await documentClient.put({
    TableName: process.env.TABLE_NAME,
    Item: item
  });

  return {
    statusCode: 200,
    body: JSON.stringify(item),
    headers: {
      'Content-Type': 'application/json'
    }
  };
}