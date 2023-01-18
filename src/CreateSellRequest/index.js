
export default async function handler(event) {
  console.log('event: ', event);

  return {
    status: 200,
    body: JSON.stringify(event, null, 2),
    headers: {
      'Content-Type': 'application/json'
    }
  };
}