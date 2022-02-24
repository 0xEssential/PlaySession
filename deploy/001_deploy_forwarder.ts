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

  await deploy('EssentialForwarder', {
    from: deployer,
    args: ['0xEssential PlaySession', ['https://middleware.nfight.xyz']],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
};
export default func;
func.tags = ['Forwarder'];
