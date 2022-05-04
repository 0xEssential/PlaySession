import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {getChainId} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const networkName = await getChainId().then(
    (id) =>
      ({
        80001: 'mumbai',
        137: 'matic',
      }[id])
  );

  if (!networkName) return;
  const {deployer} = await getNamedAccounts();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ForwarderDeployment = require(`../deployments/${networkName}/EssentialForwarder.json`);

  await deploy('EssentialPlaySession', {
    from: deployer,
    args: [ForwarderDeployment.address],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
};
export default func;
func.tags = ['Forwarder'];
