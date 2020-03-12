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
    
    stage('Test and Code Review') {
      parallel {
        stage('Test'){
          agent{
            label 'noi-linux-ubuntu16-ci-slave'
          }
          steps {
            catchError{
              sh 'npm install'
              sh 'npm install nyc'
              sh 'npm install mocha-junit-reporter --save-dev'
              sh './node_modules/nyc/bin/nyc.js -a --reporter "cobertura" --reporter "lcovonly" ./node_modules/mocha/bin/mocha test --reporter mocha-junit-reporter'
            }
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
                //sh 'id -un'
                checkout scm
                sh "cd $JENKINS_HOME/workspace/devicejs_${env.BRANCH_NAME} && ${scannerHome}/bin/sonar-scanner"
              }
            }
          }
        }
      }
    }
    
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
        withCredentials([usernamePassword(credentialsId: 'noida_slave_password', passwordVariable: 'JENKINS_PASSWORD', usernameVariable: 'JENKINS_USERNAME')]) {
          sh "echo ${JENKINS_PASSWORD} | sudo -S npm -g install gh-pages"
          sh "echo ${JENKINS_PASSWORD} | sudo -S gh-pages --dist docs/ --user \"edge-ci <edge-ci@arm.com>\""
        }
      }
    }
  }
  
  post{
    /*success{
      //slackSend(channel: '#edge-jenkins-ci', color: 'good', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }
    failure{
      //slackSend(channel: '#edge-jenkins-ci', color: 'danger', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }
    unstable{
      //slackSend(channel: '#edge-jenkins-ci', color: 'warning', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }*/
    always{
      node('noi-linux-ubuntu16-ci-slave'){
        junit 'test-results.xml'
        step([$class: 'CoberturaPublisher', autoUpdateHealth: false, autoUpdateStability: false, coberturaReportFile: 'coverage/cobertura-coverage.xml', failUnhealthy: false, failUnstable: false, maxNumberOfBuilds: 0, onlyStable: false, sourceEncoding: 'ASCII', zoomCoverageChart: false])
        //archiveArtifacts artifacts: 'devicedb_docs.md'
      }
    }
 }
}
