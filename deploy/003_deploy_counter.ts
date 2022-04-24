import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {getChainId} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();
  const {deploy} = hre.deployments;

  const networkName = await getChainId().then(
    (id) =>
      ({
        80001: 'mumbai',
        137: 'matic',
      }[id])
  );

  if (!networkName) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ForwarderDeployment = require(`../deployments/${networkName}/EssentialForwarder.json`);

  await deploy('Counter', {
    from: deployer,

    args: [ForwarderDeployment.address],
    log: true,
  });
};
export default func;
func.tags = ['Counter'];
