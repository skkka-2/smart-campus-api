const Router = require('koa-router');
const chatController = require('../controllers/chatController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.use(requireAuth);

router.post('/socket-ticket', chatController.createSocketTicket);
router.get('/users/search', chatController.searchUsers);
router.get('/friends', chatController.listFriends);
router.get('/friend-requests', chatController.listFriendRequests);
router.post('/friend-requests', chatController.createFriendRequest);
router.patch('/friend-requests/:requestId', chatController.respondFriendRequest);
router.delete('/friends/:userId', chatController.removeFriend);
router.get('/conversations', chatController.listConversations);
router.post('/conversations/direct', chatController.createDirectConversation);
router.post('/conversations/group', chatController.createGroup);
router.get('/conversations/:conversationId', chatController.getConversation);
router.patch('/conversations/:conversationId', chatController.updateGroup);
router.get('/conversations/:conversationId/messages', chatController.listMessages);
router.post('/conversations/:conversationId/read', chatController.markRead);
router.get('/group-invites', chatController.listGroupInvites);
router.patch('/group-invites/:inviteId', chatController.respondGroupInvite);
router.get('/groups/:groupId', chatController.getGroup);
router.get('/groups/:groupId/members', chatController.listGroupMembers);
router.post('/groups/:groupId/invites', chatController.createGroupInvite);
router.post('/groups/:groupId/members', chatController.addGroupMember);
router.delete('/groups/:groupId/members/:userId', chatController.removeGroupMember);
router.patch('/groups/:groupId/members/:userId/role', chatController.updateGroupMemberRole);
router.post('/groups/:groupId/leave', chatController.leaveGroup);
router.get('/history', chatController.history);

module.exports = router;
