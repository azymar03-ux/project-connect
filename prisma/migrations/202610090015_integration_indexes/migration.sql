-- CreateIndex
CREATE INDEX "AiConversation_userId_createdAt_id_idx" ON "AiConversation"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiTurn_conversationId_createdAt_id_idx" ON "AiTurn"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GithubLink_owner_repo_installationId_idx" ON "GithubLink"("owner", "repo", "installationId");

