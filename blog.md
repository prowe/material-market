Me and my son were talking about a game idea over the weekend.
In this game players would build small economies and trade with each other to simulate a supply chain.
That requires a way to trade items and materials (like copper, wheat, etc.) without both players needing to be online at the same time .
This is effectively a commodities market. 
Let’s see if we can build such a market on a AWS.

One big challenge to building a market like this is that it requires the ability to know what the best price is for a given item. 
Players will post items for sale at a certain price, and other players will buy a quantity of items at the lowest price.
This is a concurrency problem at scale. 
Adding a bunch of records to a database and simply querying up the lowest value for a given item is simple enough in theory.
In practice, this design results in lots of locks being taken,and contention on the table as a bunch of concurrent users try to buy from the cheapest seller at a given time.

What we need is a way to take all of the items that are for sale and keep them in a sorted list and then just throttle the buyers requests such that two buyers are not trying to buy the same item at the same time.
This can be simply solved by running one instance of a server that processes buyer requests sequentially one after another.
However, for obvious reasons, this won’t scale very well. 
Instead, we could take advantage of the natural partitioning of a buyer that’s trying to buy on material does not conflict with buyers of other materials.

Both Kinesis and Kafka are queuing systems that provide a guarantee that for given partition key, no two instance of a consumer will consume that same key at the same time.
AWS lambda configuration for consuming from a Kinesis stream, actually provides a parameter that explicitly controls this attribute. 
We can leverage this property tof Kinesis to partition all orders by material and then use a Lambda function to pair those up with the opisite side of the transaction.

This data pipeline will start with a client posting an `Order` payload that looks like this:
```Json
{
    "type": "Sell",
    "material": "wheat",
    "quantity": 100,
    "pricePerUnit": 10
}
```

We can create a Lambda with a URL that will receive the request, validate it, and land it into a DynamoDB Table.
Importantly, this table needs to use a specific key strategy to ensure that we can easily match up orders.
The hash key will be the material and the range key will be the type, followed by a left padded price and a UUID to make it unique.
We cannot also send the order to a Kinesis stream because that can introduce a consistancy risk.
If the Dynamo put is first but the Kinesis publish fails then we will have an orphaned `order` in the table.
If the Kinesis publish is first and the Dynamo put fails then we will have an event for an `order` that was never saved.

Instead, we can enable a change stream on the table that will generate an event on every item change.
We still need to get these events into Kinesis.
In order to do that we can leverage Event Bridge Pipes to forward the events from the table change stream into Kinesis.
The Pipe configuration allows us to set the `Key` on the Kinesis message to be the value of the `material` property from the Dynamo event.
We'll put another Lambda on the other end of this stream.
This lambda, as discussed earlier, will never have more than one instance per `key` (a.k.a Material).
It will take the material, query up the oppisite order that matches it.
Assuming the price is good, it will decrement the qantity from both orders and delete them if they are fulfilled in one single DynamoDB transaction.

