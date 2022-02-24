#!/usr/bin/env bash
NETWORK=${1?Error: No network provided}
# cd deployments/$NETWORK
for f in deployments/$NETWORK/*.json
do
  file=basename $f
  cp -v "$f" /Users/samuelsbauch/Code/playsession-demo/abis/$file
  #  cp -v "$f" /Users/samuelsbauch/Code/wrasslers/subgraph/abis/$f
done
