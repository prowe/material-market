Me and my son were talking about a game idea over the weekend.
In this game players would build small economies and trade with each other to simulate a supply chain.
That requires a way to trade items and materials (like copper, wheat, etc.) without both players needing to be online at the same time.
This is effectively a commodities market. 
Let’s see if we can build such a market on a AWS.

One big challenge to building a market like this is that it requires the ability to know what the best price is for a given material. 
Players will post items for sale at a certain price, and other players will buy a quantity of that material at the lowest price.
This is a concurrency problem at scale. 
Adding a bunch of records to a database and simply querying up the lowest value for a given item is simple enough in theory.
In practice, this design results in lots of locks being taken, and contention on the table as a bunch of concurrent users try to buy from the cheapest seller at a given time.

What we need is a way to take all of the items that are for sale and keep them in a sorted list and then just queue the buyers requests such that two buyers are not trying to buy the same item at the same time.
This can be simply solved by running one instance of a server that processes buyer requests sequentially one after another.
However, for obvious reasons, this won’t scale very well. 
Instead, we could take advantage of the natural partitioning of a buyer that’s trying to buy on material does not conflict with buyers of other materials.

Both [Kinesis](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) and [Kafka](https://kafka.apache.org) are queueing systems that provide the guarantee that, for given partition key, no two instance of a consumer will consume that same key at the same time.
AWS Lambda [event configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-kinesis.html#sam-function-kinesis-parallelizationfactor) for consuming from a Kinesis stream actually provides a parameter that explicitly controls this attribute. 
We can leverage this property tof Kinesis to partition all orders by material and then use a Lambda function to pair those up with the oppisite side of the transaction.

This data pipeline will start with a client posting an `Order` payload that looks like this:
```Json
{
    "type": "Sell",
    "material": "wheat",
    "quantity": 100,
    "pricePerUnit": 10
}
```

We can create a [Lambda with a URL](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html) that will receive the request, validate it, and land it into a DynamoDB Table.
Importantly, this table needs to use a specific key strategy to ensure that we can easily match up orders.
The [partition key](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html#HowItWorks.CoreComponents.PrimaryKey) will be the material and the sort key will be the type, followed by a left padded price and a UUID to make it unique.
We cannot also send the order to a Kinesis stream because that can introduce a consistancy risk.
If the Dynamo put is first but the Kinesis publish fails then we will have an orphaned `order` in the table.
If the Kinesis publish is first and the Dynamo put fails then we will have an event for an `order` that was never saved.

Instead, we can enable a [change stream](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html) on the table that will generate an event on every item change.
We still need to get these events into Kinesis.
In order to do that we can leverage [Event Bridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html) to forward the events from the table change stream into Kinesis.
The Pipe configuration allows us to set the `Key` on the Kinesis message to be the value of the `material` property from the Dynamo event.
We'll put another Lambda on the other end of this stream.
This lambda, as discussed earlier, will never have more than one instance per `key` (a.k.a material).
It will take the order, query up the oppisite order that matches it.
Assuming the price is good, it will decrement the quantity from both orders and delete them if they are fulfilled in one single [DynamoDB transaction](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).

This example is charactaristic of the challenges with *Event Driven Architecture*.
With many asynchronous activities in-flight, coordination between events to either prevent collisions or to ensure multiple activites are atomic becomes necessary.
By leveraging the strengths of the various services, we can solve these probems without writing and manging coordination code ourselves.
Our architecture has vastly more scale and reliability than a single server providing order coordination. 
It does have a limit, if a lot of users are trying to buy and sell the same material than the stream can backup for that material.
This can be mitigated by ensuring that our processing Lambda is as efficent as possible.
The complete example project is [available on GitHub](https://github.com/prowe/material-market)