import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {getChainId} from 'hardhat';
import {EssentialForwarderDeployments} from '@0xessential/signers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();
  const {deploy} = hre.deployments;

  const chain = (await getChainId()) as keyof typeof EssentialForwarderDeployments;

  await deploy('Counter', {
    from: deployer,
    args: [EssentialForwarderDeployments[chain].address],
    log: true,
  });
};
export default func;
func.tags = ['Counter'];
