/**
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

import { BlockEvent, BlockListener, Contract, ContractEvent, ContractListener, Gateway, Network, ListenerOptions, EventType } from 'fabric-network';
import { Constants } from '../constants';
import * as GatewayHelper from './gateway';
import * as BaseUtils from './utility/baseUtils';
import { StateStore } from './utility/stateStore';

const stateStore: StateStore = StateStore.getInstance();

export async function createContractListener(gatewayName: string, channelName: string, ccName: string, eventName: string, listenerName: string, type: EventType, startBlock?: number): Promise<void> {
	const gateways: Map<string, any> = stateStore.get(Constants.GATEWAYS);
	const gateway: Gateway  = gateways.get(gatewayName).gateway;
	const contract: Contract = await GatewayHelper.retrieveContractFromGateway(gateway, channelName, ccName);

	let listeners: Map<string, any> = stateStore.get(Constants.LISTENERS);
	const listenerObject: any = {
		active: true,
		calls: 0,
		eventName,
		eventType: type,
		listener: {},
		payloads: [],
		type: Constants.CONTRACT,
	};

	// If no listeners, then create the new map item
	if (!listeners) {
		listeners = new Map();
		stateStore.set(Constants.LISTENERS, listeners);
	}

	const contractListener: ContractListener = async (event: ContractEvent) => {
		BaseUtils.logMsg(`-> Received a contract event for listener [${listenerName}] of type ${eventName}`);

		if (event.eventName !== eventName) {
			return;
		}

		// TODO: support for full blocks
		// if (!filtered) {
		// 	const [event]: any = args as any;
		// 	if (event && Object.prototype.hasOwnProperty.call(event, 'payload')) {
		// 		BaseUtils.checkString(event.payload.toString('utf8'), 'content', true);
		// 	}
		// }

		const tlisteners: any = stateStore.get(Constants.LISTENERS);
		if (tlisteners) {
			const listenerUpdate: any = tlisteners.get(listenerName);
			if (listenerUpdate) {
				listenerUpdate.payloads.push(event);
				listenerUpdate.calls = listenerUpdate.payloads.length;
			}
		}
	};

	// Create the listener
	const listenerOptions: ListenerOptions = {
		startBlock,
		type
	};
	await contract.addContractListener(contractListener, listenerOptions);

	// Roll into a listener object to store
	listenerObject.listener = contractListener;
	listenerObject.remove = () => contract.removeContractListener(contractListener);
	listeners.set(listenerName, listenerObject);
	stateStore.set(Constants.LISTENERS, listeners);
}

export async function createBlockListener(gatewayName: string, channelName: string, listenerName: string, type: EventType, startBlock?: number, endBlock?: number): Promise<void> {
	const gateways: Map<string, any> = stateStore.get(Constants.GATEWAYS);
	const gateway: Gateway = gateways.get(gatewayName).gateway;
	const network: Network = await gateway.getNetwork(channelName);

	let listeners: Map<string, any> = stateStore.get(Constants.LISTENERS);
	const listenerObject: any = {
		active: true,
		calls: 0,
		eventType: type,
		listener: {},
		payloads: [],
		type: Constants.BLOCK
	};

	// If no listeners, then create the new map item
	if (!listeners) {
		listeners = new Map();
	}

	// Create the listener
	const listener: BlockListener = async (blockEvent: BlockEvent) => {
		BaseUtils.logMsg('->Received a block event', listenerName);
		if (startBlock) {
			BaseUtils.checkSizeEquality(blockEvent.blockNumber.toNumber(), startBlock - 1, true, true);
		}
		if (endBlock) {
			BaseUtils.checkSizeEquality(blockEvent.blockNumber.toNumber(), endBlock + 1, false, true);
		}

		const tlisteners: any = stateStore.get(Constants.LISTENERS);
		if (tlisteners) {
			const listenerUpdate: any = tlisteners.get(listenerName);
			if (listenerUpdate) {
				listenerUpdate.payloads.push(blockEvent);
				listenerUpdate.calls = listenerUpdate.payloads.length;
			}
		}

		if (endBlock && blockEvent.blockNumber.greaterThanOrEqual(endBlock)) {
			network.removeBlockListener(listener);
		}
	};
	const listenerOptions: ListenerOptions = {
		startBlock,
		type
	};
	await network.addBlockListener(listener, listenerOptions);

	// Roll into a listener object to store
	listenerObject.listener = listener;
	listenerObject.remove = () => network.removeBlockListener(listener);
	listeners.set(listenerName, listenerObject);
	stateStore.set(Constants.LISTENERS, listeners);
}

export function getListenerObject(listenerName: string): any {
	const listeners: Map<string, any> = stateStore.get(Constants.LISTENERS);
	if (!listeners || !listeners.has(listenerName)) {
		const msg: string = `Unable to find listener with name ${listenerName}`;
		BaseUtils.logAndThrow(msg);
	} else {
		return listeners.get(listenerName);
	}
}

export function resetListenerCalls(listenerName: string): void {
	const listener: any = getListenerObject(listenerName);
	listener.payloads = [];
	listener.calls = 0;
}

export async function checkListenerCallNumber(listenerName: string, compareNumber: number, type: string): Promise<void> {
	await new Promise( (resolve: any): any => {
		let timeout: any = null;
		const interval: NodeJS.Timeout = setInterval(() => {
			let condition: boolean;
			switch (type) {
				case Constants.EXACT:
					condition = Number(getListenerObject(listenerName).calls) === Number(compareNumber);
					break;
				case Constants.GREATER_THAN:
					condition = Number(getListenerObject(listenerName).calls) >= Number(compareNumber);
					break;
				case Constants.LESS_THAN:
					condition = Number(getListenerObject(listenerName).calls) <= Number(compareNumber);
					break;
				default:
					throw new Error(`Unknown condition type ${type} passed to checkListenerCallNumber()`);
			}

			if (condition)  {
				clearInterval(interval);
				clearTimeout(timeout);
				resolve();
			}
		}, Constants.INC_TINY);

		// Make sure this doesn't run forever! We condition actual errors in the following code block
		timeout = setTimeout(() => {
			clearInterval(interval);
			resolve();
		}, Constants.STEP_SHORT);
	});

	const gatewayListenerCalls: number = getListenerObject(listenerName).calls;
	switch (type) {
		case Constants.EXACT:
			if (Number(gatewayListenerCalls) !== Number(compareNumber)) {
				const msg: string = `Expected ${listenerName} to be called ${compareNumber} times, but was called ${gatewayListenerCalls} times`;
				BaseUtils.logAndThrow(msg);
			} else {
				const msg: string = `Verified that the listener was called exactly ${compareNumber} times`;
				BaseUtils.logMsg(msg);
			}
			break;
		case Constants.GREATER_THAN:
			if (Number(gatewayListenerCalls) < Number(compareNumber)) {
				throw new Error(`Expected ${listenerName} to be called a minimum ${compareNumber} times, but called ${gatewayListenerCalls} times`);
			} else {
				const msg: string = `Verified that the listener was called at least ${compareNumber} times`;
				BaseUtils.logMsg(msg);
			}
			break;
		case Constants.LESS_THAN:
				if (Number(gatewayListenerCalls) > Number(compareNumber)) {
					throw new Error(`Expected ${listenerName} to be called a maximum ${compareNumber} times, but called ${gatewayListenerCalls} times`);
				} else {
					const msg: string = `Verified that the listener was called a maximum ${compareNumber} times`;
					BaseUtils.logMsg(msg);
				}
				break;
		default:
			throw new Error(`Unknown condition type ${type} passed to checkListenerCallNumber()`);
	}
}

export function checkContractListenerDetails(listenerName: string, listenerType: string, eventType: EventType, eventName: string, isActive: boolean): void {
	const listenerObject: any = getListenerObject(listenerName);

	// Check the listener properties
	if ( (listenerObject.active !== isActive) || (listenerObject.type.localeCompare(listenerType) !== 0) || (listenerObject.eventName.localeCompare(eventName) !== 0) || (listenerObject.eventType !== eventType)) {
		const msg: string = `Listener named ${listenerName} does not have the expected properties [type: ${listenerType}, eventName: ${eventName}, eventType: ${eventType}, active: ${isActive}]`;
		BaseUtils.logAndThrow(msg);
	}
}

export function checkBlockListenerDetails(listenerName: string, listenerType: string, eventType: EventType, isActive: boolean): void {
	const listenerObject: any = getListenerObject(listenerName);

	// Check the listener properties
	if ( (listenerObject.active !== isActive) || (listenerObject.type.localeCompare(listenerType) !== 0) || (listenerObject.eventType !== eventType)) {
		const msg: string = `Listener named ${listenerName} does not have the expected properties [type: ${listenerType}, eventType: ${eventType}, active: ${isActive}]`;
		BaseUtils.logAndThrow(msg);
	}
}

export function checkTransactionListenerDetails(listenerName: string, listenerType: string, isActive: boolean): void {
	const listenerObject: any = getListenerObject(listenerName);

	// Check the listener properties
	if ( (listenerObject.active !== isActive) || (listenerObject.type.localeCompare(listenerType) !== 0) ) {
		const msg: string = `Listener named ${listenerName} does not have the expected properties [type: ${listenerType}, active: ${isActive}]`;
		BaseUtils.logAndThrow(msg);
	}
}

export function unregisterListener(listenerName: string) {
	const listenerObject = getListenerObject(listenerName);
	listenerObject.remove();
	listenerObject.active = false;
}
