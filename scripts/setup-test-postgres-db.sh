#!/bin/bash

# 停止并删除已存在的容器
docker stop postgres-paradedb 2> /dev/null && docker rm postgres-paradedb 2> /dev/null

# 启动pgvector容器
docker run --name postgres-paradedb \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 \
  -d paradedb/paradedb:latest

# 等待PostgreSQL启动
echo "等待PostgreSQL完全启动..."
sleep 5

# 确保postgres用户存在且有适当权限
docker exec postgres-pgvector psql -U postgres -c "\du"

echo "✅ PostgreSQL with paradedb 已成功启动，并配置好了 postgres 用户"
echo "连接字符串: postgres://postgres:mysecretpassword@localhost:5432/postgres"
