import 'dotenv/config';
import '@nomiclabs/hardhat-ethers';
import {ethers, getChainId} from 'hardhat';
import {Counter, EssentialForwarder} from '../typechain';
import {wrapContract} from '@0xessential/metassential';
import {BigNumber, constants, Contract, Signer} from 'ethers';
import {JsonRpcProvider} from '@ethersproject/providers';
import {Web3Provider} from '@ethersproject/providers';
import {Logger} from 'ethers/lib/utils';

async function main() {
  const accounts = await ethers.getSigners();
  const networkName = await getChainId().then(
    (id) =>
      ({
        80001: 'mumbai',
        // 137: 'matic',
      }[id])
  );
  console.warn(networkName);
  if (!networkName) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Forwarder = require(`../deployments/${networkName}/EssentialForwarder.json`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Counter = require(`../deployments/${networkName}/Counter.json`);

  const [owner, burner] = accounts;
  const provider = new JsonRpcProvider(process.env.MUMBAI_RPC_URL);
  const burnerForwarder = new Contract(Forwarder.address, Forwarder.abi, provider) as EssentialForwarder;
  const ownerForwarder = new Contract(Forwarder.address, Forwarder.abi, provider) as EssentialForwarder;

  const burnerCounter = new Contract(Counter.address, Counter.abi, burner) as Counter;

  // const authorize = await ownerForwarder.createSession(burner.address, 604_800, {gasLimit: 80_000});
  // await authorize.wait();

  const wrappedCounter = wrapContract(
    burner.provider as Web3Provider,
    burner.address,
    burnerCounter,
    Object.assign(burnerForwarder, {name: '0xEssential PlaySession'})
  ) as Contract;

  const {signature, request} = await wrappedCounter.incrementFromForwarderOnly(
    '0x495fb4483d1782e92df66685920b857d52db93e3',
    BigNumber.from(18),
    owner.address
  );

  console.warn(signature, request);

  // const data = burnerForwarder.interface.encodeFunctionData('preflight', [request, signature]);

  // const result = await burner.provider?.sendTransaction(data);
  // console.warn(result);
  try {
    const result = await ownerForwarder.preflight(request, signature, {gasLimit: 21_000_000, gasPrice: 800});
    console.warn(result);
  } catch (e: any) {
    if (e.code === Logger.errors.CALL_EXCEPTION) {
      // If the error was SomeCustomError(), we can get the args...
      if (e.errorName === 'OffchainLookup') {
        const {sender, urls, callData, callbackFunction, extraData} = e.errorArgs;
        console.warn(sender, urls, callData, callbackFunction, extraData);
      }
    }
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
