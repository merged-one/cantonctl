SHELL := /usr/bin/env bash

ifneq (,$(wildcard .env))
    include .env
endif

ifndef MODULES_DIR
  export MODULES_DIR=$(shell pwd)/docker/modules
endif

ifndef LOCALNET_DIR
  export LOCALNET_DIR=$(MODULES_DIR)/localnet
endif

DOCKER_COMPOSE_FILES := -f compose.yaml
DOCKER_COMPOSE_FILES += -f ${LOCALNET_DIR}/compose.yaml
DOCKER_COMPOSE_ENVFILE := --env-file .env --env-file .env.local --env-file ${LOCALNET_DIR}/compose.env --env-file ${LOCALNET_DIR}/env/common.env

.PHONY: start
start:
	@echo "starting localnet"

.PHONY: stop
stop:
	@echo "stopping localnet"

.PHONY: status
status:
	@echo "status localnet"
