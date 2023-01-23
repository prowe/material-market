#!/bin/bash

set -e

PAYLOAD_FILE=$1
FUNCTION_URL=$(aws cloudformation describe-stacks \
    --stack-name=prowe-material-market \
    --query="Stacks[0].Outputs[?OutputKey=='CreateOpenOrderUrl'].OutputValue" \
    --output=text)

echo "Submitting ${PAYLOAD_FILE} to ${FUNCTION_URL}"
cat $PAYLOAD_FILE | curl -X POST \
    -H "Content-Type: application/json" \
    -d @- \
    --url $FUNCTION_URL