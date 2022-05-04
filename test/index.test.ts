import {expect} from 'chai';
import {Contract} from 'ethers';
import {ethers} from 'hardhat';
import {setupUsers} from './utils';
import {signMetaTxRequest} from '@0xessential/signers';
import {EssentialForwarder} from '../typechain';
import {handleOffchainLookup} from './utils/offchainLookupMock';

const deployContracts = async () => {
  const Forwarder = await ethers.getContractFactory('EssentialForwarder');
  const forwarder = (await Forwarder.deploy('0xEssential PlaySession', [
    'http://localhost:8000',
  ])) as EssentialForwarder;
  await forwarder.deployed();

  const PlaySession = await ethers.getContractFactory('EssentialPlaySession');
  const playSession = await PlaySession.deploy(forwarder.address);
  await playSession.deployed();

  const Counter = await ethers.getContractFactory('Counter');
  const counter = await Counter.deploy(forwarder.address);
  await counter.deployed();

  const signers = await ethers.getSigners();

  const users = (await setupUsers(
    signers.map((signer) => signer.address),
    {
      counter,
      forwarder,
    }
  )) as any[];

  await users[0].forwarder.setPlaySessionOperator(playSession.address);

  return {
    counter,
    forwarder,
    users,
  };
};

describe.only('Counter', function () {
  let fixtures: {
    counter: Contract;
    forwarder: EssentialForwarder;
    users: ({
      address: string;
    } & {
      counter: Contract;
      forwarder: EssentialForwarder;
      wrappedCounter: Contract;
    })[];
  };

  before(async () => {
    fixtures = await deployContracts();
  });

  it('Starts at 0', async function () {
    const {
      counter,
      users: [_relayer, account],
    } = fixtures;

    expect(await counter.count(account.address)).to.equal(0);
  });

  describe('count', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.increment()).to.be.revertedWith('429');
    });

    it('Increments via Forwarder with OffchainLookup proof', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract],
      } = fixtures;

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: account.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        account.forwarder
      );

      await relayer.forwarder.preflight(request as any, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);
        if (match) {
          await handleOffchainLookup(match, relayer, forwarder, account);

          const count = await counter.count(account.address);

          expect(count).to.equal(1);
        } else {
          expect(e).to.eq(false);
        }
      });
    });
  });

  describe('increment with PlaySession', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('Reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.increment()).to.be.revertedWith('429');
    });

    it('Reverts when owner has no PlaySession', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner],
      } = fixtures;

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: burner.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        account.forwarder
      );

      await relayer.forwarder.preflight(request as any, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          await expect(handleOffchainLookup(match, relayer, forwarder, account)).to.be.revertedWith('Unauthorized()');

          const count = await counter.count(account.address);

          expect(count).to.equal(0);
        } else {
          expect(e).to.eq(false);
        }
      });
    });

    it('Reverts when burner not current session beneficiary', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner, activeBurner],
      } = fixtures;

      const createSession = await account.forwarder.createSession(activeBurner.address, 10_000);

      await createSession.wait();

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: burner.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        account.forwarder
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          await expect(handleOffchainLookup(match, relayer, forwarder, account)).to.be.revertedWith('Unauthorized()');

          const count = await counter.count(account.address);

          expect(count).to.equal(0);
        } else {
          expect(e).to.eq(false);
        }
      });
    });

    it('Increments when burner is authorized', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner],
      } = fixtures;

      const createSession = await account.forwarder.createSession(burner.address, 10_000);
      await createSession.wait();

      const data = burner.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        burner.counter.provider,
        31337,
        {
          to: burner.counter.address,
          from: burner.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        burner.forwarder
      );
      console.warn(request, signature);
      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);
        if (match) {
          await handleOffchainLookup(match, relayer, forwarder, burner);

          const count = await counter.count(account.address);

          expect(count).to.equal(1);
        } else {
          expect(e).to.eq(true);
        }
      });
    });
  });
});
