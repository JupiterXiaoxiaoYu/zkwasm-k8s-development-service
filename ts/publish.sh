#!/bin/bash

# 加载环境变量
if [ -f .env ]; then
  echo "Loading environment variables from .env file"
  source .env
elif [ -f ../.env ]; then
  echo "Loading environment variables from parent directory .env file"
  source ../.env
else
  echo "No .env file found"
fi

PUBLISH_CMD="node ./node_modules/zkwasm-service-cli/dist/index.js addimage -r \"https://rpc.zkwasmhub.com:8090\" -p \"./node_modules/zkwasm-ts-server/src/application/application_bg.wasm\" -u \"${USER_ADDRESS}\" -x \"${USER_PRIVATE_ACCOUNT}\" -d \"Multi User App\" -c 22 --auto_submit_network_ids 11155111 -n \"test-chart\" --creator_only_add_prove_task true"

if [ "FALSE" = "TRUE" ] || [ "FALSE" = "true" ]; then
  if [ -n "" ]; then
    echo "Migration enabled, adding import_data_image parameter with value: "
    PUBLISH_CMD="${PUBLISH_CMD} --import_data_image "
  else
    echo "Warning: Migration is enabled but MIGRATE_IMAGE_VALUE is not set"
  fi
fi

# 执行命令
eval ${PUBLISH_CMD}
