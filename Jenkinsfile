import hudson.Util;
import net.sf.json.JSONArray;
import net.sf.json.JSONObject;

projectName = 'DeviceJS'
//branchName = "${env.GIT_BRANCH}"

def notifySlack(String buildStatus = 'UNSTABLE') {
    branchName = "${env.BRANCH_NAME}"
    print branchName
    buildStatus = buildStatus ?: 'SUCCESSFUL' 
    def colorCode = '#FF0000' 
 
    if (buildStatus == 'UNSTABLE') { 
        //colorName = 'YELLOW' 
        colorCode = '#FFFF00' 
    } else if (buildStatus == 'SUCCESS') { 
        //colorName = 'GREEN' 
        colorCode = '#00FF00' 
    } else { 
        //colorName = 'RED' 
        colorCode = '#FF0000' 
    } 
 
    def mainText = '*Name -> <' + env.RUN_DISPLAY_URL + '|' + projectName.toString() + '>*'
 
    JSONArray attachments = new JSONArray();
    JSONObject detailsAttachment = new JSONObject(); 

 
    // Create details field for attachment.  
    JSONArray fields = new JSONArray(); 
    JSONObject fieldsObject = new JSONObject(); 

    JSONObject branch = new JSONObject();
    fieldsObject.put('title', 'Branch');
    fieldsObject.put('value', branchName.toString());
    fieldsObject.put('short', true);

    fields.add(fieldsObject); 

    fieldsObject.put('title','Status'); 
    fieldsObject.put('value',buildStatus.toString()); 
    fieldsObject.put('short',true); 
    
    fields.add(fieldsObject); 
    
    fieldsObject = new JSONObject(); 
    fieldsObject.put('title','Job ID'); 
    fieldsObject.put('value','#' + env.BUILD_NUMBER.toString()); 
    fieldsObject.put('short',true); 
    
    fields.add(fieldsObject); 
    
    // Put fields JSONArray 
    detailsAttachment.put('pretext',"Ran DeviceJS CI pipeline on Jenkins"); 
    detailsAttachment.put('title',"Sonarqube Dashboard");
    detailsAttachment.put('title_link',"http://pe-jm.usa.arm.com:9000/dashboard?id=edge%3Adevicejs%3A"+"${branchName}"); 
    //detailsAttachment.put('author_name',"LAVA Job");
    //detailsAttachment.put('author_link',"http://lava.mbedcloudtesting.com/scheduler/alljobs");
    detailsAttachment.put('text',"Click to view Sonarqube Dashboard");
    detailsAttachment.put('fields',fields); 
    detailsAttachment.put('color', colorCode.toString());
    detailsAttachment.put('footer','After ' + Util.getTimeSpanString(System.currentTimeMillis() - currentBuild.startTimeInMillis)) 
    
    attachments.add(detailsAttachment); 

    print detailsAttachment
    
    // Send notifications 
    slackSend (message: mainText.toString(), attachments: attachments.toString()) 
    
}

pipeline {
  agent none
  options{
    skipDefaultCheckout()
  }
  stages {
    stage('Environment setup'){
      agent{
         label 'noi-linux-ubuntu16-ci-slave'
      }
      steps{
        withCredentials([usernamePassword(credentialsId: 'noida_slave_password', passwordVariable: 'JENKINS_PASSWORD', usernameVariable: 'JENKINS_USERNAME')]) {
          sh "curl -sL https://deb.nodesource.com/setup_12.x | echo ${JENKINS_PASSWORD} | sudo -SE bash -"
          sh 'echo ${JENKINS_PASSWORD} | sudo -S apt-get install -y nodejs'
        }
      }
    }
    stage('Fetch Code'){
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps{
        cleanWs()
        checkout scm
      }
    }
    stage('Build') {
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
       steps {
         withEnv(["GOROOT=/home/jenkins/go", "GOPATH=/home/jenkins/goprojects", "PATH+GO=/home/jenkins/goprojects/bin:/home/jenkins/go/bin"]){
          sh './build.sh'
         }
      }
    }
    
    //stage('Test and Code Review') {
      //parallel {
        stage('Test'){
          agent{
            label 'noi-linux-ubuntu16-ci-slave'
          }
          steps {
            catchError(buildResult: 'SUCCESS'){
              sh 'npm install'
              sh 'npm install nyc'
              sh 'npm install mocha-junit-reporter --save-dev'
              sh './node_modules/nyc/bin/nyc.js --reporter "cobertura" --reporter "lcovonly" ./node_modules/mocha/bin/mocha test --reporter mocha-junit-reporter'
            }
            stash includes: 'coverage/lcov.info', name: 'sonar-coverage'
          }
        }
        
        stage('SonarQube'){
          agent{
            label 'master'
          }
          environment {
            scannerHome = tool 'SonarQubeScanner'
          }
          steps {
            catchError(buildResult: 'SUCCESS', stageResult: 'FAILURE'){
              withSonarQubeEnv('sonarqube') {
                withCredentials([usernamePassword(credentialsId: 'noida_slave_password', passwordVariable: 'JENKINS_PASSWORD', usernameVariable: 'JENKINS_USERNAME')]) {
                  checkout scm
                  unstash 'sonar-coverage'
                  sh "cd $JENKINS_HOME/workspace/devicejs_${env.BRANCH_NAME} && ${scannerHome}/bin/sonar-scanner"
                }
              }
            }
          }
        }
      //}
    //}
    
    stage('Auto Doc') {
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'noida_slave_password', passwordVariable: 'JENKINS_PASSWORD', usernameVariable: 'JENKINS_USERNAME')]) {
          sh "echo ${JENKINS_PASSWORD} | sudo -S npm -g install yuidocjs"
          sh 'yuidoc .'
        }
      }
    }
    
    stage('Publish Docs'){
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps{
         sh 'npm install gh-pages'
         sh './node_modules/gh-pages/bin/gh-pages.js --dist docs/ --user "edge-ci <edge-ci@arm.com>"'
      }
    }
  }
  
  post{
    always{
      node('noi-linux-ubuntu16-ci-slave'){
        junit 'test-results.xml'
        step([$class: 'CoberturaPublisher', autoUpdateHealth: false, autoUpdateStability: false, coberturaReportFile: 'coverage/cobertura-coverage.xml', failUnhealthy: false, failUnstable: false, maxNumberOfBuilds: 0, onlyStable: false, sourceEncoding: 'ASCII', zoomCoverageChart: false])
        notifySlack("${currentBuild.currentResult}")
      }
    }
  }
}
