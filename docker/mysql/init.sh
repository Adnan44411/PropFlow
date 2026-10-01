#!/bin/sh
# One MySQL server, two databases, two users: auth-server and crm-api can never read each other's data.
set -eu
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS auth_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS crm_db  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS auth_test; CREATE DATABASE IF NOT EXISTS crm_test;
CREATE USER IF NOT EXISTS 'auth'@'%' IDENTIFIED BY '${AUTH_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'crm'@'%'  IDENTIFIED BY '${CRM_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON auth_db.* TO 'auth'@'%';
GRANT ALL PRIVILEGES ON auth_test.* TO 'auth'@'%';
GRANT ALL PRIVILEGES ON crm_db.*  TO 'crm'@'%';
GRANT ALL PRIVILEGES ON crm_test.*  TO 'crm'@'%';
FLUSH PRIVILEGES;
SQL
