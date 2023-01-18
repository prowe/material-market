#!/bin/bash

set +e

PAYLOAD_FILE=$1
FUNCTION_URL=$(aws cloudformation describe-stacks \
    --stack-name=prowe-material-market \
    --query="Stacks[0].Outputs[?OutputKey=='CreateSellRequestUrl'].OutputValue" \
    --output=text)

echo "Submitting ${PAYLOAD_FILE} to ${FUNCTION_URL}"
curl -X POST -d @${PAYLOAD_FILE} --url $FUNCTION_URL