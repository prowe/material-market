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
We can leverage this property to use Kinesis to partition all buyer requests by material and then use a serverless Lambda function to consume those events and dispatch the goods for sale to the appropriate buyers.

We have two data pipelines to build: One for the buyers, and one for the sellers.
We'll start with the seller pipeline as it slightly simpler. 
A client will Post a JSON payload to a URL containing the material, quantity and price per unit.
A Lamda will recieve that request, validate it, and land it into a DynamoDB Table.
Importantly, this table needs to use a specific key strategy to ensure that we can easily query up materials.
The hash key will be the material and the range key will start with a padded price.
Since two users could sell the same material for the same price we don't have a unique key so we can just concatinate a UUID on the end to make it unique.

The buyer pipeline is a little more complicated than the seller.
It starts with a POST request to a url that contains the material, desired quanity, and the price the buyer is willing to pay.
This request will also be handled by a Lambda that will validate it and land the record in another DynamoDB table.
We want to store the requests in a table so there is an easy way for buyers to query up their requests.
We also need to get this event into a Kinesis stream.
If we send it to the stream in the same Lambda that saves to the table the we introduce a consistency risk since the operations are not atomic. 
Instead, we can enable a change stream on the table that will generate an event on every item change.
We need to get these events into Kinesis.
In order to do that we can leverage Event Bridge Pipes to forward the events from the table change stream into Kinesis.
The Pipe configuration allows us to set the `Key` on the Kinesis message to be the value of the `material` property from the Dynamo event.
We'll put another Lambda on the other end of this stream. 
This lambda, as discussed earlier, will never have more than one instance per `key` (a.k.a Material).
It will take the material, query up the lowest priced sale and determine if it can fulfill the buy request.
Assuming the price is good, it will decrement the sell qantity and increment the filled quantity in one DyanamoDB transaction.

