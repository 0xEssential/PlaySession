import 'dotenv/config';
import '@nomiclabs/hardhat-ethers';
import {ethers, getChainId} from 'hardhat';
import {EssentialForwarder} from '../typechain';

async function main() {
  const {deployer} = await ethers.getNamedSigners();
  const networkName = await getChainId().then(
    (id) =>
      ({
        80001: 'mumbai',
        137: 'matic',
      }[id])
  );
  console.warn(networkName);
  if (!networkName) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {abi, address} = require(`../deployments/${networkName}/EssentialForwarder.json`);

  const Forwarder = (await ethers.getContractAt(abi, address, deployer)) as EssentialForwarder;

  await Forwarder.setOwnershipSigner('0xEd0DA2E00Ae45afd92EB55605dfaD11284087480');
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
