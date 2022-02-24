#!/usr/bin/env bash
NETWORK=${1}

POLYGONSCAN_API_KEY=$(grep POLYGONSCAN_API_KEY .env | xargs)
POLYGONSCAN_API_KEY=${POLYGONSCAN_API_KEY#*=}

if [[ $NETWORK == 'matic' ]]
then
   cd deployments/$NETWORK
  for f in *.json
  do
    ADDRESS=`jq -r '.address' $f`
    open https://polygonscan.com/address/${ADDRESS}
  done
else
  cd deployments/$NETWORK
  for f in *.json
  do
    ADDRESS=`jq -r '.address' $f`
    open https://mumbai.polygonscan.com/address/${ADDRESS}
  done
fi
