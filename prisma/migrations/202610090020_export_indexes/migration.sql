-- Scoped export keyset lookups. Owner review required maintenance window for large existing tables.
CREATE INDEX "Project_ownerId_id_idx" ON "Project"("ownerId","id");
CREATE INDEX "Member_userId_id_idx" ON "Member"("userId","id");
CREATE INDEX "Application_userId_id_idx" ON "Application"("userId","id");
CREATE INDEX "Message_senderId_id_idx" ON "Message"("senderId","id");
CREATE INDEX "Resource_submittedById_id_idx" ON "Resource"("submittedById","id");
CREATE INDEX "HardwareStore_submittedById_id_idx" ON "HardwareStore"("submittedById","id");
CREATE INDEX "ProjectMessage_senderId_id_idx" ON "ProjectMessage"("senderId","id");
CREATE INDEX "ProjectFile_uploaderId_id_idx" ON "ProjectFile"("uploaderId","id");
CREATE INDEX "AiPlan_userId_id_idx" ON "AiPlan"("userId","id");
CREATE INDEX "AiTurn_userId_id_idx" ON "AiTurn"("userId","id");
CREATE INDEX "AiConversation_userId_id_idx" ON "AiConversation"("userId","id");
CREATE INDEX "Activity_authorId_id_idx" ON "Activity"("authorId","id");
CREATE INDEX "Notification_userId_id_idx" ON "Notification"("userId","id");
CREATE INDEX "Report_reporterId_id_idx" ON "Report"("reporterId","id");
CREATE INDEX "ProjectInvite_inviterId_id_idx" ON "ProjectInvite"("inviterId","id");
