const express = require('express');
const { deployNFTCollection, prepareDeployNFTCollection, mintNFT, prepareMintNFT, getNFTInfo } = require('../controllers/nftController');

const router = express.Router();

// NFT collection deployment (server-side signing — legacy)
router.post('/deploy-collection', deployNFTCollection);

// NFT collection deployment (unsigned — client signs via CSPR.click)
router.post('/prepare-deploy-collection', prepareDeployNFTCollection);

// Mint NFT (server-side signing — legacy)
router.post('/mint', mintNFT);

// Mint NFT (unsigned — client signs via CSPR.click)
router.post('/prepare-mint', prepareMintNFT);

// NFT information
router.get('/info/:collectionAddress/:tokenId', getNFTInfo);

module.exports = router;
