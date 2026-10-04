import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestGate} from '../lib/request-gate.mjs';
test('Late PNG A response cannot overwrite selected PNG B',async()=>{
 const gate=new RequestGate();let displayed=null;let completeA,completeB;
 const a=gate.start(),promiseA=new Promise(r=>completeA=r).then(value=>{if(gate.isCurrent(a))displayed=value;});
 const b=gate.start(),promiseB=new Promise(r=>completeB=r).then(value=>{if(gate.isCurrent(b))displayed=value;});
 completeB('B');await promiseB;completeA('A');await promiseA;assert.equal(displayed,'B');
});
test('Late FileReader/inspection completion and finalizer are invalidated',()=>{
 const gate=new RequestGate();const read=gate.start();const render=gate.start();const latest=gate.start();
 assert.equal(gate.isCurrent(read),false);assert.equal(gate.isCurrent(render),false);assert.equal(gate.isCurrent(latest),true);
});
