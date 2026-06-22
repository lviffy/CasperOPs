const express = require('express');
const { deployNFTCollection, mintNFT, getNFTInfo } = require('../controllers/nftController');

const router = express.Router();

// NFT collection deployment
router.post('/deploy-collection', deployNFTCollection);

// Mint NFT
router.post('/mint', mintNFT);

// NFT information
router.get('/info/:collectionAddress/:tokenId', getNFTInfo);

module.exports = router;
